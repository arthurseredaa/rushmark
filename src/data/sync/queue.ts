/**
 * The pending save queue.
 *
 * Constitution Principle II: "A pending save MUST leave the queue only by
 * success or by explicit user discard. Failure keeps it queued with the cause
 * recorded and surfaced. There is no path from pending to dropped."
 *
 * That sentence is the whole design. This module exposes exactly three exits:
 *
 *   resolve(videoId)  — the upload succeeded
 *   discard(videoId)  — the user said to drop it
 *   recordFailure(..) — NOT an exit. The row stays; we note why.
 *
 * There is deliberately no `clear()`, no `prune()`, no `dropOlderThan()`, and no
 * expiry. If a save has been failing for a month, that is a month of the user's
 * work we are still holding, and the answer is to tell them — not to tidy up.
 */

import type * as SQLite from 'expo-sqlite';

import type { Canonical } from '@/domain/canonical';

import { pendingSaves, type PendingSaveRow } from '../db/repositories';

export type { PendingSaveRow };

export type QueueOp = 'upsert' | 'delete';

/**
 * Queue a save the user has already confirmed.
 *
 * The full canonical is snapshotted here, not a reference to live state. When
 * this publishes days later the editor may have moved on, but what the user
 * confirmed is what must reach Drive — a reference would publish whatever
 * happened to be current at drain time, which is not what they agreed to.
 */
export async function enqueue(
  db: SQLite.SQLiteDatabase,
  input: { videoId: string; op: QueueOp; payload: Canonical | null },
): Promise<void> {
  await pendingSaves.enqueue(db, input);
}

export const list = (db: SQLite.SQLiteDatabase): Promise<PendingSaveRow[]> =>
  pendingSaves.list(db);

export const count = (db: SQLite.SQLiteDatabase): Promise<number> =>
  pendingSaves.count(db);

export const pendingVideoIds = (db: SQLite.SQLiteDatabase): Promise<Set<string>> =>
  pendingSaves.videoIdsPending(db);

/** Exit 1 of 2: the save reached Drive. */
export const resolve = (db: SQLite.SQLiteDatabase, videoId: string): Promise<void> =>
  pendingSaves.resolve(db, videoId);

/** Exit 2 of 2: the user explicitly chose to abandon this save. */
export const discard = (db: SQLite.SQLiteDatabase, videoId: string): Promise<void> =>
  pendingSaves.discard(db, videoId);

/**
 * NOT an exit. Records why the attempt failed and leaves the row in place.
 */
export const recordFailure = (
  db: SQLite.SQLiteDatabase,
  videoId: string,
  error: string,
): Promise<void> => pendingSaves.recordFailure(db, videoId, error);
