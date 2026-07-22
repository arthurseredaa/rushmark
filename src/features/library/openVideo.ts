/**
 * Getting a video onto the device so it can be played frame-accurately.
 * FR-006, FR-006a, FR-006b, FR-009.
 */

import type * as SQLite from 'expo-sqlite';

import { videos } from '@/data/db/repositories';
import { mediaUrl } from '@/data/drive/files';
import * as videoCache from '@/data/cache/videoCache';
import * as connectivity from '@/data/sync/connectivity';
import { getAccessToken } from '@/features/auth/googleAuth';

export type OpenState =
  | { kind: 'cached'; path: string }
  | { kind: 'needs-download'; sizeBytes: number | null; onCellular: boolean }
  | { kind: 'unavailable'; reason: string };

/**
 * What opening this video will require, without doing it.
 *
 * Split from the download itself so the UI can ask before spending the user's
 * cellular allowance on a 68 MB clip (FR-006a) — the decision belongs to them,
 * and asking afterwards is not asking.
 */
export async function inspect(
  db: SQLite.SQLiteDatabase,
  input: { videoId: string; folderId: string; filename: string; sizeBytes: number | null },
): Promise<OpenState> {
  const path = await videoCache.cachedPath(input.folderId, input.filename);
  if (path) return { kind: 'cached', path };

  const { online, cellular } = await connectivity.current();
  if (!online) {
    return {
      kind: 'unavailable',
      reason:
        'This video is not downloaded and you are offline. Videos you have already downloaded ' +
        'are still fully editable.',
    };
  }

  return { kind: 'needs-download', sizeBytes: input.sizeBytes, onCellular: cellular };
}

export type DownloadHandle = {
  promise: Promise<string>;
  cancel: () => Promise<void>;
};

/**
 * Download the original into the cache.
 *
 * Call only after `inspect` returned `needs-download` and the user has agreed to
 * any cellular cost.
 */
export function startDownload(
  db: SQLite.SQLiteDatabase,
  input: {
    videoId: string;
    folderId: string;
    filename: string;
    driveFileId: string;
    onProgress?: (p: videoCache.DownloadProgress) => void;
  },
): DownloadHandle {
  let cancelled = false;
  let inner: videoCache.DownloadHandle | null = null;

  const promise = (async (): Promise<string> => {
    const token = await getAccessToken();
    if (cancelled) throw new Error('Download cancelled');

    inner = videoCache.download({
      folderId: input.folderId,
      filename: input.filename,
      url: mediaUrl(input.driveFileId),
      token,
      onProgress: input.onProgress,
    });

    const path = await inner.promise;

    // Record the cached path so the library can show it as downloaded without
    // hitting the filesystem for every row.
    await videos.setCachedPath(db, input.videoId, path);
    return path;
  })();

  return {
    promise,
    cancel: async () => {
      cancelled = true;
      await inner?.cancel();
    },
  };
}

/** Human-readable size for the confirmation prompt. */
export function formatBytes(bytes: number | null): string {
  if (bytes === null) return 'unknown size';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${Math.round(mb)} MB`;
}
