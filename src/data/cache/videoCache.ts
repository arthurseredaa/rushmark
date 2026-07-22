/**
 * Cached video originals on disk.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ THIS MODULE MUST NOT IMPORT FROM @/data/db OR @/data/sync.               │
 * │                                                                         │
 * │ Constitution Principle II: "Clearing cached video MUST NOT be able to    │
 * │ reach unpublished work. The separation MUST hold by construction, not by │
 * │ careful coding."                                                         │
 * │                                                                         │
 * │ This module is therefore incapable of touching the database. Clearing the│
 * │ cache is a filesystem operation and nothing more, so FR-036 cannot be    │
 * │ broken by a future edit that "just needs one query here". The lint rule  │
 * │ in eslint.config.js and the test in T063 both enforce it.                │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Uses the LEGACY expo-file-system API deliberately: `createDownloadResumable`
 * is the only API that reports progress and supports cancel, which FR-006b
 * requires. The newer File/Directory API is tidier but cannot do either.
 */

import * as FileSystem from 'expo-file-system/legacy';

/**
 * Documents/, NOT Caches/.
 *
 * FR-010 forbids Caches/: iOS purges it under storage pressure, which would
 * silently delete a video the user downloaded before a flight — precisely when
 * they cannot download it again. The user reclaims this space explicitly instead
 * (FR-030).
 *
 * ⚠️ KNOWN GAP (task T069): plan.md specifies this directory be excluded from
 * iCloud backup, and it currently is NOT. iOS backs Documents/ up by default, so
 * cached originals will count against the user's iCloud quota and upload over
 * their connection. Excluding it requires setting NSURLIsExcludedFromBackupKey
 * on the directory, which expo-file-system does not expose in either its legacy
 * or modern API — it needs a small native shim. This is a resource-usage bug,
 * not a correctness one: nothing here is authored work (that lives in SQLite),
 * and the files are re-downloadable. Left explicit rather than quietly dropped.
 */
const ROOT = `${FileSystem.documentDirectory ?? ''}videos/`;

export type DownloadProgress = {
  totalBytes: number;
  writtenBytes: number;
  /** 0..1, or null when Drive did not report a total. */
  fraction: number | null;
};

export type DownloadHandle = {
  promise: Promise<string>;
  cancel: () => Promise<void>;
};

const folderDir = (folderId: string): string => `${ROOT}${encodeURIComponent(folderId)}/`;

const videoPath = (folderId: string, filename: string): string =>
  `${folderDir(folderId)}${encodeURIComponent(filename)}`;

async function ensureDir(path: string): Promise<void> {
  const info = await FileSystem.getInfoAsync(path);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(path, { intermediates: true });
  }
}

/** The cached file's path, or null when it is not on disk. */
export async function cachedPath(
  folderId: string,
  filename: string,
): Promise<string | null> {
  const path = videoPath(folderId, filename);
  const info = await FileSystem.getInfoAsync(path);
  return info.exists ? path : null;
}

/**
 * Download a video into the cache, reporting progress and supporting cancel.
 *
 * Writes to `<name>.partial` and moves into place only on completion, so an
 * interrupted download can never be mistaken for a cached copy
 * (contracts/drive-api.md §3).
 */
export function download(input: {
  folderId: string;
  filename: string;
  url: string;
  token: string;
  onProgress?: (progress: DownloadProgress) => void;
}): DownloadHandle {
  const finalPath = videoPath(input.folderId, input.filename);
  const partialPath = `${finalPath}.partial`;

  const resumable = FileSystem.createDownloadResumable(
    input.url,
    partialPath,
    { headers: { Authorization: `Bearer ${input.token}` } },
    (data) => {
      const total = data.totalBytesExpectedToWrite;
      input.onProgress?.({
        totalBytes: total,
        writtenBytes: data.totalBytesWritten,
        // Drive reports -1 for unknown length; a fraction would be a lie.
        fraction: total > 0 ? data.totalBytesWritten / total : null,
      });
    },
  );

  const promise = (async (): Promise<string> => {
    await ensureDir(folderDir(input.folderId));

    // A stale .partial from a previous interrupted attempt is not resumable
    // across app launches without its resumeData, so start clean.
    const partialInfo = await FileSystem.getInfoAsync(partialPath);
    if (partialInfo.exists) {
      await FileSystem.deleteAsync(partialPath, { idempotent: true });
    }

    const result = await resumable.downloadAsync();
    if (!result) {
      // downloadAsync resolves undefined when cancelled.
      throw new Error('Download cancelled');
    }

    await FileSystem.moveAsync({ from: partialPath, to: finalPath });
    return finalPath;
  })();

  return {
    promise,
    cancel: async () => {
      try {
        await resumable.cancelAsync();
      } finally {
        await FileSystem.deleteAsync(partialPath, { idempotent: true });
      }
    },
  };
}

/** Bytes currently used by one folder's cached videos. */
export async function folderSize(folderId: string): Promise<number> {
  const dir = folderDir(folderId);
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) return 0;

  const names = await FileSystem.readDirectoryAsync(dir);
  let total = 0;
  for (const name of names) {
    const fileInfo = await FileSystem.getInfoAsync(`${dir}${name}`);
    if (fileInfo.exists && !fileInfo.isDirectory) {
      total += fileInfo.size ?? 0;
    }
  }
  return total;
}

export async function totalSize(): Promise<number> {
  const info = await FileSystem.getInfoAsync(ROOT);
  if (!info.exists) return 0;

  const folders = await FileSystem.readDirectoryAsync(ROOT);
  let total = 0;
  for (const folder of folders) {
    total += await folderSize(decodeURIComponent(folder));
  }
  return total;
}

/**
 * Delete a folder's cached videos (FR-030).
 *
 * Note what this cannot do: reach the database. Pending saves, authored
 * metadata, and markers are untouchable from here — not because this function is
 * careful, but because this module has no way to address them.
 */
export async function clearFolder(folderId: string): Promise<void> {
  await FileSystem.deleteAsync(folderDir(folderId), { idempotent: true });
}

export async function clearAll(): Promise<void> {
  await FileSystem.deleteAsync(ROOT, { idempotent: true });
}

/** Remove one cached video. */
export async function remove(folderId: string, filename: string): Promise<void> {
  await FileSystem.deleteAsync(videoPath(folderId, filename), { idempotent: true });
}
