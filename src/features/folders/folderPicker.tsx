/**
 * Browse Drive and pick a folder to connect (FR-001).
 *
 * Drive has no folder-picker API, so this is a plain navigable list from `root`.
 * A native picker would be nicer; there isn't one for Drive on iOS without
 * pulling in the whole Google Picker web view, which is a poor fit for six REST
 * calls.
 */

import * as React from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { type DriveFile, listFolders } from '@/data/drive/files';
import { Button, Empty, Loading } from '@/ui/components';
import { useDrive } from '@/ui/AppProviders';
import { spacing, theme } from '@/ui/theme';

type Crumb = { id: string; name: string };

export function FolderPicker({
  visible,
  onCancel,
  onPick,
}: {
  visible: boolean;
  onCancel: () => void;
  onPick: (folder: { id: string; name: string }) => void;
}): React.ReactElement {
  const drive = useDrive();
  const [crumbs, setCrumbs] = React.useState<Crumb[]>([{ id: 'root', name: 'My Drive' }]);
  const [folders, setFolders] = React.useState<DriveFile[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const currentCrumb = crumbs[crumbs.length - 1];
  const current = currentCrumb ?? { id: 'root', name: 'My Drive' };

  React.useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setFolders(null);
    setError(null);

    listFolders(drive, current.id)
      .then((result) => {
        if (!cancelled) setFolders(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      cancelled = true;
    };
  }, [drive, current.id, visible]);

  const reset = (): void => {
    setCrumbs([{ id: 'root', name: 'My Drive' }]);
    setFolders(null);
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel}>
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Pressable onPress={onCancel} accessibilityRole="button">
            <Text style={styles.cancel}>Cancel</Text>
          </Pressable>
          <Text style={styles.title} numberOfLines={1}>
            {current.name}
          </Text>
          <View style={styles.headerSpacer} />
        </View>

        {crumbs.length > 1 ? (
          <Pressable
            style={styles.up}
            accessibilityRole="button"
            onPress={() => setCrumbs((c) => c.slice(0, -1))}
          >
            <Text style={styles.upLabel}>‹ {crumbs[crumbs.length - 2]?.name}</Text>
          </Pressable>
        ) : null}

        {error ? (
          <Empty title="Could not read Drive" detail={error} />
        ) : folders === null ? (
          <Loading label="Reading Drive…" />
        ) : folders.length === 0 ? (
          <Empty
            title="No subfolders here"
            detail="You can still connect this folder if your videos are in it."
          />
        ) : (
          <FlatList
            data={folders}
            keyExtractor={(f) => f.id}
            renderItem={({ item }) => (
              <Pressable
                style={styles.row}
                accessibilityRole="button"
                onPress={() => setCrumbs((c) => [...c, { id: item.id, name: item.name }])}
              >
                <Text style={styles.rowLabel} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={styles.chevron}>›</Text>
              </Pressable>
            )}
          />
        )}

        <View style={styles.footer}>
          <Button
            label={`Connect “${current.name}”`}
            disabled={current.id === 'root'}
            onPress={() => {
              onPick({ id: current.id, name: current.name });
              reset();
            }}
          />
          {current.id === 'root' ? (
            <Text style={styles.hint}>Open a folder to connect it.</Text>
          ) : null}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.border,
  },
  cancel: { color: theme.accent, fontSize: 16, width: 70 },
  title: { color: theme.text, fontSize: 17, fontWeight: '600', flex: 1, textAlign: 'center' },
  headerSpacer: { width: 70 },
  up: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  upLabel: { color: theme.accent, fontSize: 15 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.border,
  },
  rowLabel: { color: theme.text, fontSize: 16, flex: 1 },
  chevron: { color: theme.textDim, fontSize: 20 },
  footer: {
    padding: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.border,
  },
  hint: { color: theme.textDim, fontSize: 13, textAlign: 'center', marginTop: spacing.sm },
});
