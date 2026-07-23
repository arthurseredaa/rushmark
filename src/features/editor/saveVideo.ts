/**
 * The save pipeline. FR-024 … FR-029a, FR-034.
 *
 * One entry point, two outcomes: published now, or queued for later. The user's
 * confirmation is the same gesture either way, and they are never asked to
 * confirm the same save twice (Principle II).
 */

import type * as SQLite from 'expo-sqlite';

import { buildCanonical, type Canonical, type Marker, type Probe } from '@/domain/canonical';
import { metadata, videos } from '@/data/db/repositories';
import { DriveError, type DriveClient } from '@/data/drive/client';
import { deleteSidecars, publishSidecars } from '@/data/drive/sidecars';
import * as connectivity from '@/data/sync/connectivity';
import * as queue from '@/data/sync/queue';

export type SaveInput = {
  videoId: string;
  filename: string;
  folderId: string;
  driveFileId: string;
  probe: Probe;
  comments: string;
  keywords: readonly string[];
  description: string;
  people: readonly string[];
  goodTake: boolean;
  markers: readonly Marker[];
  unknownFields?: Record<string, unknown>;
  appVersion?: string;
};

export type SaveOutcome =
  | { status: 'published' }
  | { status: 'queued'; reason: 'offline' }
  | { status: 'cleared' }
  | { status: 'cleared-queued' };

/** Nothing authored — a save in this state means "remove the sidecars" (FR-029a). */
const isEmpty = (input: {
  comments: string;
  keywords: readonly string[];
  description: string;
  people: readonly string[];
  goodTake: boolean;
  markers: readonly Marker[];
}): boolean =>
  input.comments.trim() === '' &&
  input.keywords.length === 0 &&
  input.description.trim() === '' &&
  input.people.length === 0 &&
  !input.goodTake &&
  input.markers.length === 0;

export function buildCanonicalFor(input: SaveInput): Canonical {
  return buildCanonical({
    filename: input.filename,
    driveFileId: input.driveFileId,
    probe: input.probe,
    comments: input.comments,
    keywords: input.keywords,
    description: input.description,
    people: input.people,
    goodTake: input.goodTake,
    markers: input.markers,
    appVersion: input.appVersion ?? '1.0.0',
    // Left to default (now): the canonical records when it was written.
  });
}

/**
 * Save a video's metadata.
 *
 * Writes locally FIRST, always. The local store is what makes the work durable
 * (Principle II) — if we published first and the app died before writing local
 * state, the user's next open would show them stale data and invite them to
 * overwrite their own save.
 */
export async function saveVideo(
  db: SQLite.SQLiteDatabase,
  client: DriveClient,
  input: SaveInput,
): Promise<SaveOutcome> {
  const clearing = isEmpty(input);
  const { online } = await connectivity.current();

  if (clearing) {
    await metadata.clear(db, input.videoId);

    if (!online) {
      await queue.enqueue(db, { videoId: input.videoId, op: 'delete', payload: null });
      return { status: 'cleared-queued' };
    }

    try {
      await deleteSidecars(client, { folderId: input.folderId, filename: input.filename });
      return { status: 'cleared' };
    } catch (err) {
      await queue.enqueue(db, { videoId: input.videoId, op: 'delete', payload: null });
      if (err instanceof DriveError && err.kind === 'offline') {
        return { status: 'cleared-queued' };
      }
      throw err;
    }
  }

  // Throws on a marker that cannot be honoured (VFR, out of bounds, bad colour).
  // Better here, before anything is written, than halfway through publishing.
  const canonical = buildCanonicalFor(input);

  await metadata.save(db, {
    videoId: input.videoId,
    comments: input.comments,
    keywords: input.keywords,
    description: input.description,
    people: input.people,
    goodTake: input.goodTake,
    markers: input.markers,
    unknownFields: input.unknownFields ?? {},
    syncState: online ? 'local-only' : 'pending',
    dirty: true,
  });

  if (!online) {
    // The designed path, not a failure. Confirmed once, published later (FR-034).
    await queue.enqueue(db, {
      videoId: input.videoId,
      op: 'upsert',
      payload: canonical,
    });
    await metadata.setSyncState(db, input.videoId, 'pending');
    return { status: 'queued', reason: 'offline' };
  }

  try {
    await publishSidecars(client, {
      folderId: input.folderId,
      filename: input.filename,
      canonical,
    });
    await metadata.setSyncState(db, input.videoId, 'published', Date.now());
    return { status: 'published' };
  } catch (err) {
    // Connectivity can drop between the check above and the upload. Queue rather
    // than tell the user their work failed — it hasn't.
    if (err instanceof DriveError && err.kind === 'offline') {
      await queue.enqueue(db, {
        videoId: input.videoId,
        op: 'upsert',
        payload: canonical,
      });
      await metadata.setSyncState(db, input.videoId, 'pending');
      return { status: 'queued', reason: 'offline' };
    }

    // A real refusal from Drive (permission, quota, gone). Queue it anyway — the
    // work stays recoverable — but let the caller surface the cause (FR-038).
    await queue.enqueue(db, { videoId: input.videoId, op: 'upsert', payload: canonical });
    await metadata.setSyncState(db, input.videoId, 'failed');
    await queue.recordFailure(
      db,
      input.videoId,
      err instanceof Error ? err.message : String(err),
    );
    throw err;
  }
}

/** Cache the probe so the video list and a later offline open do not need the file. */
export async function rememberProbe(
  db: SQLite.SQLiteDatabase,
  videoId: string,
  probe: Probe,
): Promise<void> {
  await videos.setProbe(db, videoId, probe);
}
