/**
 * A folder's videos. FR-003, FR-004, FR-011, FR-012, FR-030, FR-039.
 */

import { Link, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as React from 'react';
import {
  Alert,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import * as videoCache from '@/data/cache/videoCache';
import {
  folders,
  keywords as keywordRepo,
  metadata,
  videos,
  type VideoRow,
} from '@/data/db/repositories';
import { listFolders, listVideos, type DriveFile } from '@/data/drive/files';
import * as queue from '@/data/sync/queue';
import { formatBytes } from '@/features/library/openVideo';
import {
  useConnectivity,
  useDatabase,
  useDatabaseReady,
  useDrive,
} from '@/ui/AppProviders';
import { Badge, Banner, Button, Empty, Loading } from '@/ui/components';
import { useDownloads } from '@/ui/DownloadHost';
import { spacing, theme } from '@/ui/theme';

type SortKey = 'name' | 'metadata' | 'downloaded';

export default function FolderScreen(): React.ReactElement {
  const ready = useDatabaseReady();
  if (!ready) return <Loading />;
  return <Screen />;
}

function Screen(): React.ReactElement {
  const { folderId, name: nameParam } = useLocalSearchParams<{
    folderId: string;
    name?: string;
  }>();
  const db = useDatabase();
  const drive = useDrive();
  const { online } = useConnectivity();
  const { items: downloadItems } = useDownloads();

  // When we arrive by tapping a subfolder we already know its name (passed in the
  // route), so the header reads correctly before Drive answers. A saved folder's
  // name from the DB still wins once loadLocal runs.
  const [name, setName] = React.useState(nameParam ?? 'Videos');
  const [rows, setRows] = React.useState<VideoRow[] | null>(null);
  const [subfolders, setSubfolders] = React.useState<DriveFile[]>([]);
  const [withMetadata, setWithMetadata] = React.useState<Set<string>>(new Set());
  const [pending, setPending] = React.useState<Set<string>>(new Set());
  const [allKeywords, setAllKeywords] = React.useState<string[]>([]);
  const [filter, setFilter] = React.useState<string | null>(null);
  const [filtered, setFiltered] = React.useState<Set<string> | null>(null);
  const [sort, setSort] = React.useState<SortKey>('name');
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [cacheBytes, setCacheBytes] = React.useState(0);

  /** Local state only — works offline (FR-032). */
  const loadLocal = React.useCallback(async () => {
    if (!folderId) return;
    const [folder, list, meta, pendingIds, kw, bytes] = await Promise.all([
      folders.get(db, folderId),
      videos.listByFolder(db, folderId),
      metadata.videoIdsWithMetadata(db, folderId),
      queue.pendingVideoIds(db),
      keywordRepo.listForFolder(db, folderId),
      videoCache.folderSize(folderId),
    ]);
    if (folder) setName(folder.name);
    setRows(list);
    setWithMetadata(meta);
    setPending(pendingIds);
    setAllKeywords(kw);
    setCacheBytes(bytes);
  }, [db, folderId]);

  /** Refresh the listing from Drive. Requires network; local view survives without. */
  const refreshFromDrive = React.useCallback(async () => {
    if (!folderId || !online) return;
    setError(null);
    try {
      // Videos live here; subfolders are the branches the user can descend into
      // (FR-004a). Fetched together so one refresh reflects the whole level.
      const [files, subs] = await Promise.all([
        listVideos(drive, folderId),
        listFolders(drive, folderId),
      ]);
      await videos.upsertMany(
        db,
        folderId,
        files.map((f) => ({
          id: f.id,
          filename: f.name,
          driveFileId: f.id,
          sizeBytes: f.size ? Number(f.size) : null,
          thumbnailUrl: f.thumbnailLink ?? null,
        })),
      );
      setSubfolders(subs);
      await folders.touch(db, folderId);
      await loadLocal();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [db, drive, folderId, online, loadLocal]);

  useFocusEffect(
    React.useCallback(() => {
      void loadLocal();
    }, [loadLocal]),
  );

  React.useEffect(() => {
    void (async () => {
      await loadLocal();
      await refreshFromDrive();
    })();
    // Intentionally once per folder: pull-to-refresh is the manual path.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folderId]);

  React.useEffect(() => {
    if (!folderId) return;
    if (filter === null) {
      setFiltered(null);
      return;
    }
    void keywordRepo.videoIdsWithKeyword(db, folderId, filter).then(setFiltered);
  }, [db, folderId, filter]);

  const visible = React.useMemo(() => {
    if (!rows) return null;
    const base = filtered ? rows.filter((r) => filtered.has(r.id)) : rows;
    const sorted = [...base];
    switch (sort) {
      case 'metadata':
        sorted.sort((a, b) => {
          const av = withMetadata.has(a.id) ? 0 : 1;
          const bv = withMetadata.has(b.id) ? 0 : 1;
          return av - bv || a.filename.localeCompare(b.filename);
        });
        break;
      case 'downloaded':
        sorted.sort((a, b) => {
          const av = a.cachedPath ? 0 : 1;
          const bv = b.cachedPath ? 0 : 1;
          return av - bv || a.filename.localeCompare(b.filename);
        });
        break;
      default:
        sorted.sort((a, b) => a.filename.localeCompare(b.filename));
    }
    return sorted;
  }, [rows, filtered, sort, withMetadata]);

  const handleClearCache = (): void => {
    if (!folderId) return;
    Alert.alert(
      'Clear downloaded videos?',
      `This frees ${formatBytes(cacheBytes)} by deleting this folder's downloaded video files ` +
        'from your device.\n\nYour comments, keywords, and markers are not touched — including ' +
        'any saves still waiting to publish.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              // Two calls, deliberately. videoCache cannot reach the database
              // (Principle II, FR-036), so clearing the cachedPath column is the
              // caller's job — which is exactly the separation we want.
              await videoCache.clearFolder(folderId);
              await videos.clearCachedPaths(db, folderId);
              await loadLocal();
            })();
          },
        },
      ],
    );
  };

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: name }} />

      {error ? (
        <View style={styles.bannerWrap}>
          <Banner tone="warning" title="Could not refresh from Drive" detail={error} />
        </View>
      ) : null}

      {!online ? (
        <View style={styles.bannerWrap}>
          <Banner tone="info" title="Offline — showing your downloaded videos" />
        </View>
      ) : null}

      {allKeywords.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.bar}
          contentContainerStyle={styles.chips}
        >
          <Text style={styles.barLabel}>Filter</Text>
          <Chip label="All" active={filter === null} onPress={() => setFilter(null)} />
          {allKeywords.map((k) => (
            <Chip
              key={k}
              label={k}
              active={filter === k}
              onPress={() => setFilter(filter === k ? null : k)}
            />
          ))}
        </ScrollView>
      ) : null}

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.bar}
        contentContainerStyle={styles.chips}
      >
        <Text style={styles.barLabel}>Sort</Text>
        <Chip label="Name" active={sort === 'name'} onPress={() => setSort('name')} />
        <Chip label="Has metadata" active={sort === 'metadata'} onPress={() => setSort('metadata')} />
        <Chip label="Downloaded" active={sort === 'downloaded'} onPress={() => setSort('downloaded')} />
      </ScrollView>

      <FlatList
        data={visible ?? []}
        keyExtractor={(v) => v.id}
        style={styles.listFlex}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={theme.textDim}
            onRefresh={() => {
              setRefreshing(true);
              void refreshFromDrive().finally(() => setRefreshing(false));
            }}
          />
        }
        ListHeaderComponent={
          subfolders.length > 0 && !filter ? (
            <View style={styles.folderSection}>
              {subfolders.map((f) => (
                <Link
                  key={f.id}
                  href={{
                    pathname: '/folder/[folderId]',
                    params: { folderId: f.id, name: f.name },
                  }}
                  asChild
                >
                  <Pressable style={styles.folderRow} accessibilityRole="button">
                    <Text style={styles.folderIcon}>📁</Text>
                    <Text style={styles.folderName} numberOfLines={1}>
                      {f.name}
                    </Text>
                    <Text style={styles.chevron}>›</Text>
                  </Pressable>
                </Link>
              ))}
            </View>
          ) : null
        }
        ListEmptyComponent={
          visible === null ? (
            <Loading />
          ) : (
            <Empty
              title={filter ? `No videos tagged “${filter}”` : 'No videos here'}
              detail={
                filter
                  ? undefined
                  : subfolders.length > 0
                    ? 'This folder holds only subfolders — open one above to find its videos.'
                    : online
                      ? 'This folder has no videos or subfolders.'
                      : 'Connect to the network to load this folder’s contents.'
              }
            />
          )
        }
        renderItem={({ item }) => {
          const dl = downloadItems.get(item.id);
          return (
            <Link href={`/video/${item.id}`} asChild>
              <Pressable style={styles.row} accessibilityRole="button">
                {item.thumbnailUrl ? (
                  <Image source={{ uri: item.thumbnailUrl }} style={styles.thumb} />
                ) : (
                  <View style={[styles.thumb, styles.thumbEmpty]} />
                )}
                <View style={styles.rowMain}>
                  <Text style={styles.rowTitle} numberOfLines={2}>
                    {item.filename}
                  </Text>
                  <View style={styles.badges}>
                    {dl?.phase === 'downloading' ? (
                      <Badge
                        label={`↓ ${Math.round((dl.fraction ?? 0) * 100)}%`}
                        color={theme.warning}
                      />
                    ) : null}
                    {withMetadata.has(item.id) ? (
                      <Badge label="METADATA" color={theme.success} />
                    ) : null}
                    {pending.has(item.id) ? (
                      <Badge label="PENDING" color={theme.warning} />
                    ) : null}
                    {item.cachedPath ? <Badge label="OFFLINE" color={theme.accent} /> : null}
                    {item.sizeBytes ? (
                      <Text style={styles.size}>{formatBytes(item.sizeBytes)}</Text>
                    ) : null}
                  </View>
                </View>
              </Pressable>
            </Link>
          );
        }}
      />

      {cacheBytes > 0 ? (
        <View style={styles.footer}>
          <Button
            label={`Clear ${formatBytes(cacheBytes)} of downloads`}
            variant="secondary"
            onPress={handleClearCache}
          />
        </View>
      ) : null}
    </View>
  );
}

function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}): React.ReactElement {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.chip, active && styles.chipActive]}
    >
      <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  bannerWrap: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  // A horizontal ScrollView with no height grabs free vertical space; flexGrow: 0
  // pins each bar to its content so the two rows sit snug above the list.
  bar: { flexGrow: 0 },
  chips: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, gap: spacing.sm, alignItems: 'center' },
  barLabel: { color: theme.textDim, fontSize: 12, marginRight: spacing.xs },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: 14,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
  },
  chipActive: { backgroundColor: theme.accent, borderColor: theme.accent },
  chipLabel: { color: theme.textDim, fontSize: 13 },
  chipLabelActive: { color: theme.text, fontWeight: '600' },
  listFlex: { flex: 1 },
  list: { padding: spacing.lg, gap: spacing.md, flexGrow: 1 },
  folderSection: { gap: spacing.md, marginBottom: spacing.md },
  folderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: theme.surface,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  folderIcon: { fontSize: 20 },
  folderName: { flex: 1, color: theme.text, fontSize: 15, fontWeight: '500' },
  chevron: { color: theme.textDim, fontSize: 22, marginLeft: spacing.xs },
  row: {
    flexDirection: 'row',
    backgroundColor: theme.surface,
    borderRadius: 10,
    overflow: 'hidden',
  },
  thumb: { width: 120, height: 68, backgroundColor: theme.surfaceRaised },
  thumbEmpty: { borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: theme.border },
  rowMain: { flex: 1, padding: spacing.md, justifyContent: 'space-between' },
  rowTitle: { color: theme.text, fontSize: 14, fontWeight: '500' },
  badges: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.xs },
  size: { color: theme.textDim, fontSize: 11 },
  footer: {
    padding: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.border,
  },
});
