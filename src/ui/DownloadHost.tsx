/**
 * Owns the DownloadManager's lifetime and publishes its state to the tree.
 *
 * Mounted once at the root, next to SyncEngineHost and for the same reason: a
 * download started on the video screen must keep running — and keep reporting —
 * after the user has moved back to the folder list (FR-006e). This is what turns
 * "download and go do something else" from a promise on a dead screen into a
 * first-class background task with a notification at the end.
 */

import { router } from 'expo-router';
import * as React from 'react';

import { ensurePermission, notifyDownloadComplete, onNotificationOpened } from '@/data/notifications';
import {
  DownloadManager,
  type DownloadItem,
  type StartInput,
} from '@/features/downloads/downloadManager';
import { startDownload } from '@/features/library/openVideo';

import { useDatabase, useDatabaseReady } from './AppProviders';

type DownloadContextValue = {
  items: ReadonlyMap<string, DownloadItem>;
  start: (input: StartInput) => void;
  cancel: (videoId: string) => Promise<void>;
  dismiss: (videoId: string) => void;
};

const EMPTY: ReadonlyMap<string, DownloadItem> = new Map();

const DownloadContext = React.createContext<DownloadContextValue>({
  items: EMPTY,
  start: () => {},
  cancel: async () => {},
  dismiss: () => {},
});

export const useDownloads = (): DownloadContextValue => React.useContext(DownloadContext);

/** State for a single video's download, or undefined when none is active. */
export const useDownload = (videoId: string | undefined): DownloadItem | undefined => {
  const { items } = useDownloads();
  return videoId ? items.get(videoId) : undefined;
};

export function DownloadHost({ children }: { children: React.ReactNode }): React.ReactElement {
  const ready = useDatabaseReady();
  return ready ? <Host>{children}</Host> : <>{children}</>;
}

function Host({ children }: { children: React.ReactNode }): React.ReactElement {
  const db = useDatabase();
  const [items, setItems] = React.useState<ReadonlyMap<string, DownloadItem>>(EMPTY);
  const managerRef = React.useRef<DownloadManager | null>(null);

  React.useEffect(() => {
    const manager = new DownloadManager({
      start: (input) => startDownload(db, input),
      notify: (item) => void notifyDownloadComplete(item),
    });
    managerRef.current = manager;
    const unsubscribe = manager.subscribe(setItems);

    // Ask once; a refusal just means no banners (downloads still work).
    void ensurePermission();
    // Tapping the "ready" notification jumps straight to the clip.
    const stopTapListener = onNotificationOpened((videoId) => {
      router.push(`/video/${videoId}`);
    });

    return () => {
      unsubscribe();
      stopTapListener();
      managerRef.current = null;
    };
  }, [db]);

  const value = React.useMemo<DownloadContextValue>(
    () => ({
      items,
      start: (input) => managerRef.current?.start(input),
      cancel: async (videoId) => {
        await managerRef.current?.cancel(videoId);
      },
      dismiss: (videoId) => managerRef.current?.dismiss(videoId),
    }),
    [items],
  );

  return <DownloadContext.Provider value={value}>{children}</DownloadContext.Provider>;
}
