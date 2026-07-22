/**
 * Drains the pending save queue when the network comes back.
 *
 * FR-035: publishes automatically on reconnect, without asking the user to
 * confirm a second time. They already confirmed — on the plane. Asking again
 * would be treating their earlier decision as provisional.
 */

import type * as SQLite from 'expo-sqlite';

import { metadata, videos } from '../db/repositories';
import { DriveError, type DriveClient } from '../drive/client';
import { deleteSidecars, publishSidecars } from '../drive/sidecars';

import * as connectivity from './connectivity';
import * as queue from './queue';

export type SyncResult = {
  attempted: number;
  published: number;
  failed: number;
};

export type SyncStatus = {
  running: boolean;
  pending: number;
  lastResult: SyncResult | null;
  lastError: string | null;
};

type Listener = (status: SyncStatus) => void;

export class SyncEngine {
  private running = false;
  private listeners = new Set<Listener>();
  private status: SyncStatus = {
    running: false,
    pending: 0,
    lastResult: null,
    lastError: null,
  };
  private unsubscribeReconnect: (() => void) | null = null;

  constructor(
    private readonly db: SQLite.SQLiteDatabase,
    private readonly client: DriveClient,
  ) {}

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => this.listeners.delete(listener);
  }

  private emit(patch: Partial<SyncStatus>): void {
    this.status = { ...this.status, ...patch };
    for (const listener of this.listeners) listener(this.status);
  }

  async refreshPendingCount(): Promise<void> {
    this.emit({ pending: await queue.count(this.db) });
  }

  /** Start listening for reconnects, and drain once now if already online. */
  start(): void {
    this.unsubscribeReconnect = connectivity.onReconnect(() => {
      void this.drain();
    });
    void this.refreshPendingCount();
    void connectivity.current().then(({ online }) => {
      if (online) void this.drain();
    });
  }

  stop(): void {
    this.unsubscribeReconnect?.();
    this.unsubscribeReconnect = null;
  }

  /**
   * Publish everything queued.
   *
   * Each save is independent: one failing must not block the rest, because a
   * single video with a permission problem should not hold the other nine
   * hostage.
   */
  async drain(): Promise<SyncResult> {
    if (this.running) return this.status.lastResult ?? { attempted: 0, published: 0, failed: 0 };

    this.running = true;
    this.emit({ running: true, lastError: null });

    const result: SyncResult = { attempted: 0, published: 0, failed: 0 };

    try {
      const rows = await queue.list(this.db);
      result.attempted = rows.length;

      for (const row of rows) {
        try {
          await this.publishOne(row);
          // Exit 1: success.
          await queue.resolve(this.db, row.videoId);
          await metadata.setSyncState(this.db, row.videoId, 'published', Date.now());
          result.published += 1;
        } catch (err) {
          // NOT an exit. Record the cause and leave it queued (FR-038).
          const message = err instanceof Error ? err.message : String(err);
          await queue.recordFailure(this.db, row.videoId, message);

          // Offline mid-drain is not a failure worth flagging: it just means we
          // finish next time. Anything else the user should eventually see.
          const isOffline = err instanceof DriveError && err.kind === 'offline';
          await metadata.setSyncState(
            this.db,
            row.videoId,
            isOffline ? 'pending' : 'failed',
          );
          result.failed += 1;

          if (isOffline) break; // no point trying the rest right now
        }
      }
    } finally {
      this.running = false;
      const pending = await queue.count(this.db);
      this.emit({ running: false, pending, lastResult: result });
    }

    return result;
  }

  private async publishOne(row: queue.PendingSaveRow): Promise<void> {
    const video = await videos.get(this.db, row.videoId);
    if (!video) {
      // The video is gone from the local store. We cannot know where to write,
      // and guessing would be worse than keeping it queued for a human.
      throw new Error('Video is no longer in the library');
    }

    if (row.op === 'delete') {
      await deleteSidecars(this.client, {
        folderId: video.folderId,
        filename: video.filename,
      });
      return;
    }

    if (!row.payload) {
      throw new Error('Queued save has no canonical payload');
    }

    await publishSidecars(this.client, {
      folderId: video.folderId,
      filename: video.filename,
      canonical: row.payload,
    });
  }
}
