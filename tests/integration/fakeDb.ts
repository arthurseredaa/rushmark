/**
 * A minimal in-memory stand-in for the repository layer.
 *
 * expo-sqlite is a native module and will not run under node, so the sync tests
 * mock the repositories rather than the database. That is the right seam anyway:
 * what is under test is the QUEUE STATE MACHINE — Principle II's "no path from
 * pending to dropped" — not SQLite's ability to store a row.
 */

import type { Canonical } from '@/domain/canonical';
import type { PendingSaveRow, SyncState, VideoRow } from '@/data/db/repositories';

export class FakeStore {
  videos = new Map<string, VideoRow>();
  pending = new Map<string, PendingSaveRow>();
  syncStates = new Map<string, SyncState>();

  addVideo(row: Partial<VideoRow> & { id: string }): void {
    this.videos.set(row.id, {
      folderId: 'folder1',
      filename: `${row.id}.mp4`,
      driveFileId: `drive_${row.id}`,
      sizeBytes: null,
      thumbnailUrl: null,
      cachedPath: null,
      probe: null,
      ...row,
    });
  }

  enqueue(videoId: string, op: 'upsert' | 'delete', payload: Canonical | null): void {
    this.pending.set(videoId, {
      id: `ps_${videoId}`,
      videoId,
      op,
      payload,
      confirmedAt: Date.now(),
      attempts: 0,
      lastError: null,
      lastAttemptAt: null,
    });
  }
}

/**
 * Wire a FakeStore into the repository module's exports. Returns the mocks the
 * SyncEngine will call.
 */
export function makeRepoMocks(store: FakeStore) {
  return {
    videos: {
      get: jest.fn(async (_db: unknown, id: string) => store.videos.get(id) ?? null),
      setProbe: jest.fn(async () => {}),
      setCachedPath: jest.fn(async () => {}),
      clearCachedPaths: jest.fn(async () => {}),
      listByFolder: jest.fn(async () => []),
      upsertMany: jest.fn(async () => {}),
    },
    metadata: {
      setSyncState: jest.fn(async (_db: unknown, videoId: string, state: SyncState) => {
        store.syncStates.set(videoId, state);
      }),
      get: jest.fn(async () => null),
      getMarkers: jest.fn(async () => []),
      save: jest.fn(async () => {}),
      clear: jest.fn(async () => {}),
      videoIdsWithMetadata: jest.fn(async () => new Set<string>()),
    },
    pendingSaves: {
      list: jest.fn(async () => [...store.pending.values()]),
      count: jest.fn(async () => store.pending.size),
      enqueue: jest.fn(
        async (
          _db: unknown,
          input: { videoId: string; op: 'upsert' | 'delete'; payload: Canonical | null },
        ) => {
          store.enqueue(input.videoId, input.op, input.payload);
        },
      ),
      resolve: jest.fn(async (_db: unknown, videoId: string) => {
        store.pending.delete(videoId);
      }),
      discard: jest.fn(async (_db: unknown, videoId: string) => {
        store.pending.delete(videoId);
      }),
      recordFailure: jest.fn(async (_db: unknown, videoId: string, error: string) => {
        const row = store.pending.get(videoId);
        if (row) {
          store.pending.set(videoId, {
            ...row,
            attempts: row.attempts + 1,
            lastError: error,
            lastAttemptAt: Date.now(),
          });
        }
      }),
      videoIdsPending: jest.fn(async () => new Set(store.pending.keys())),
    },
    folders: {
      list: jest.fn(async () => []),
      add: jest.fn(async () => {}),
      touch: jest.fn(async () => {}),
      remove: jest.fn(async () => {}),
      get: jest.fn(async () => null),
    },
    keywords: {
      listForFolder: jest.fn(async () => []),
      videoIdsWithKeyword: jest.fn(async () => new Set<string>()),
    },
  };
}
