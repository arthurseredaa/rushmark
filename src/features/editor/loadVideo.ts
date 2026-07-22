/**
 * Load a video's authored metadata into the editor. FR-022, FR-023a/b, FR-033.
 *
 * Read order is deliberate:
 *
 *   online  → Drive sidecar wins, and refreshes the local store
 *   offline → local store, which is why authoring on a plane works at all
 *
 * Only the canonical .json is ever read. The .csv and .otio are projections and
 * are never a source of truth (Principle III).
 */

import type * as SQLite from 'expo-sqlite';

import { parseCanonical, type Marker, type ParseWarning } from '@/domain/canonical';
import { metadata } from '@/data/db/repositories';
import { DriveError, type DriveClient } from '@/data/drive/client';
import { readCanonicalText } from '@/data/drive/sidecars';
import * as connectivity from '@/data/sync/connectivity';
import * as queue from '@/data/sync/queue';

export type LoadedMetadata = {
  comments: string;
  keywords: string[];
  markers: Marker[];
  unknownFields: Record<string, unknown>;
  warnings: ParseWarning[];
  source: 'drive' | 'local' | 'none';
  /** True when this video has an unpublished save waiting (FR-039). */
  pending: boolean;
};

const EMPTY: Omit<LoadedMetadata, 'source' | 'pending'> = {
  comments: '',
  keywords: [],
  markers: [],
  unknownFields: {},
  warnings: [],
};

async function fromLocal(
  db: SQLite.SQLiteDatabase,
  videoId: string,
): Promise<Omit<LoadedMetadata, 'source' | 'pending'> | null> {
  const row = await metadata.get(db, videoId);
  if (!row) return null;
  return {
    comments: row.comments,
    keywords: row.keywords,
    markers: await metadata.getMarkers(db, videoId),
    unknownFields: row.unknownFields,
    warnings: [],
  };
}

export async function loadVideo(
  db: SQLite.SQLiteDatabase,
  client: DriveClient,
  input: { videoId: string; folderId: string; filename: string },
): Promise<LoadedMetadata> {
  const pendingIds = await queue.pendingVideoIds(db);
  const pending = pendingIds.has(input.videoId);

  /**
   * A queued save is the user's most recent intent and has not reached Drive
   * yet. Reading Drive over the top of it would show them older data and invite
   * them to overwrite their own unpublished work — the exact loss Principle II
   * forbids. Local wins until the queue drains.
   */
  if (pending) {
    const local = await fromLocal(db, input.videoId);
    if (local) return { ...local, source: 'local', pending: true };
  }

  const { online } = await connectivity.current();

  if (online) {
    try {
      const text = await readCanonicalText(client, {
        folderId: input.folderId,
        filename: input.filename,
      });

      if (text === null) {
        // No sidecar in Drive. Fall back to anything authored locally and never
        // published, rather than showing a blank editor over the top of it.
        const local = await fromLocal(db, input.videoId);
        return local
          ? { ...local, source: 'local', pending }
          : { ...EMPTY, source: 'none', pending };
      }

      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        return {
          ...EMPTY,
          source: 'drive',
          pending,
          warnings: [
            {
              field: '/',
              message:
                'The sidecar in Drive is not valid JSON and could not be read. Saving will ' +
                'replace it.',
            },
          ],
        };
      }

      const parsed = parseCanonical(raw);

      // Mirror into the local store so the next offline open has it (FR-033).
      await metadata.save(db, {
        videoId: input.videoId,
        comments: parsed.comments,
        keywords: parsed.keywords,
        markers: parsed.markers,
        unknownFields: parsed.unknownFields,
        syncState: 'published',
        dirty: false,
        lastPublishedAt: Date.now(),
      });

      return {
        comments: parsed.comments,
        keywords: parsed.keywords,
        markers: parsed.markers,
        unknownFields: parsed.unknownFields,
        warnings: parsed.warnings,
        source: 'drive',
        pending,
      };
    } catch (err) {
      // Drive unreachable mid-read. Not fatal: fall through to local.
      if (!(err instanceof DriveError)) throw err;
    }
  }

  const local = await fromLocal(db, input.videoId);
  return local ? { ...local, source: 'local', pending } : { ...EMPTY, source: 'none', pending };
}
