/**
 * Connected folders. The app's home. FR-002, FR-004, FR-005, FR-031, FR-039/040.
 */

import { Link, useFocusEffect, useRouter } from 'expo-router';
import * as React from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import * as videoCache from '@/data/cache/videoCache';
import { folders, type FolderRow } from '@/data/db/repositories';
import { getFolder } from '@/data/drive/files';
import * as queue from '@/data/sync/queue';
import { FolderPicker } from '@/features/folders/folderPicker';
import { formatBytes } from '@/features/library/openVideo';
import { useAuth, useConnectivity, useDatabaseReady, useDatabase, useDrive } from '@/ui/AppProviders';
import { useSync } from '@/ui/SyncEngineHost';
import { Banner, Button, Empty, Loading } from '@/ui/components';
import { spacing, theme } from '@/ui/theme';

export default function FolderListScreen(): React.ReactElement {
  const ready = useDatabaseReady();
  if (!ready) return <Loading label="Opening library…" />;
  return <Screen />;
}

type Row = FolderRow & { cacheBytes: number };

function Screen(): React.ReactElement {
  const db = useDatabase();
  const drive = useDrive();
  const router = useRouter();
  const { user, restoring, signIn } = useAuth();
  const { online } = useConnectivity();
  const { status, retry } = useSync();

  const [rows, setRows] = React.useState<Row[] | null>(null);
  const [picking, setPicking] = React.useState(false);
  const [signingIn, setSigningIn] = React.useState(false);
  const [failures, setFailures] = React.useState<string[]>([]);

  const refresh = React.useCallback(async () => {
    const list = await folders.list(db);
    const withSizes = await Promise.all(
      list.map(async (f) => ({ ...f, cacheBytes: await videoCache.folderSize(f.id) })),
    );
    setRows(withSizes);

    // Surface WHY a save is stuck, not just that it is (FR-038, FR-040).
    const pending = await queue.list(db);
    setFailures(
      pending
        .filter((p) => p.lastError !== null)
        .map((p) => p.lastError as string)
        .slice(0, 3),
    );
  }, [db]);

  useFocusEffect(
    React.useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  React.useEffect(() => {
    void refresh();
  }, [refresh, status.pending]);

  const handleSignIn = async (): Promise<void> => {
    setSigningIn(true);
    try {
      await signIn();
    } catch (err) {
      Alert.alert('Sign-in failed', err instanceof Error ? err.message : String(err));
    } finally {
      setSigningIn(false);
    }
  };

  const handlePick = async (folder: { id: string; name: string }): Promise<void> => {
    setPicking(false);
    try {
      // Confirm the folder is really readable before saving it — a folder that
      // 404s later is a worse experience than a failure right now.
      const confirmed = await getFolder(drive, folder.id);
      await folders.add(db, confirmed.id, confirmed.name);
      await refresh();
      router.push(`/folder/${confirmed.id}`);
    } catch (err) {
      Alert.alert('Could not connect folder', err instanceof Error ? err.message : String(err));
    }
  };

  const handleRemove = (folder: FolderRow): void => {
    Alert.alert(
      `Remove “${folder.name}”?`,
      'This removes the folder from Rushmark and deletes its downloaded videos and local ' +
        'metadata from this device. Sidecars already published to Drive are left alone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              await videoCache.clearFolder(folder.id);
              await folders.remove(db, folder.id);
              await refresh();
            })();
          },
        },
      ],
    );
  };

  if (restoring) return <Loading label="Restoring session…" />;

  if (!user) {
    return (
      <View style={styles.container}>
        <Empty
          title="Sign in with Google"
          detail="Rushmark needs access to your Drive to read your footage and write metadata next to it."
        />
        <View style={styles.footer}>
          <Button label="Sign in with Google" onPress={handleSignIn} busy={signingIn} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {!online ? (
        <View style={styles.bannerWrap}>
          <Banner
            tone="info"
            title="Offline"
            detail="You can still edit any video you've downloaded. Saves publish when you reconnect."
          />
        </View>
      ) : null}

      {status.pending > 0 ? (
        <View style={styles.bannerWrap}>
          <Banner
            tone={failures.length > 0 ? 'warning' : 'info'}
            title={`${status.pending} save${status.pending === 1 ? '' : 's'} waiting to publish`}
            detail={
              failures.length > 0
                ? failures.join('\n')
                : online
                  ? 'Publishing…'
                  : 'They will publish automatically when you reconnect.'
            }
          />
          {online && failures.length > 0 ? (
            <Button label="Retry now" variant="secondary" onPress={() => void retry()} />
          ) : null}
        </View>
      ) : null}

      {rows === null ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Empty
          title="No folders connected"
          detail="Add a Drive folder of footage to start marking it up."
        />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(f) => f.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <Link href={`/folder/${item.id}`} asChild>
              <Pressable
                style={styles.row}
                accessibilityRole="button"
                onLongPress={() => handleRemove(item)}
              >
                <View style={styles.rowMain}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text style={styles.rowDetail}>
                    {item.cacheBytes > 0
                      ? `${formatBytes(item.cacheBytes)} downloaded`
                      : 'Nothing downloaded'}
                  </Text>
                </View>
                <Text style={styles.chevron}>›</Text>
              </Pressable>
            </Link>
          )}
        />
      )}

      <View style={styles.footer}>
        <Button label="+  Add a Drive folder" onPress={() => setPicking(true)} />
        <Text style={styles.hint}>Long-press a folder to remove it.</Text>
      </View>

      <FolderPicker
        visible={picking}
        onCancel={() => setPicking(false)}
        onPick={(f) => void handlePick(f)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  bannerWrap: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  list: { padding: spacing.lg, gap: spacing.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.surface,
    borderRadius: 10,
    padding: spacing.lg,
  },
  rowMain: { flex: 1 },
  rowTitle: { color: theme.text, fontSize: 16, fontWeight: '600' },
  rowDetail: { color: theme.textDim, fontSize: 13, marginTop: 2 },
  chevron: { color: theme.textDim, fontSize: 22 },
  footer: {
    padding: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.border,
  },
  hint: { color: theme.textDim, fontSize: 12, textAlign: 'center', marginTop: spacing.sm },
});
