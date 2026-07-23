/**
 * The only module that speaks SQL. Everything else goes through these functions.
 *
 * See data-model.md for the entities and the sync state machine.
 */

import type * as SQLite from 'expo-sqlite';

import type { Canonical, Marker, MarkerColor, Probe } from '@/domain/canonical';

export type SyncState = 'local-only' | 'pending' | 'published' | 'failed';

export type FolderRow = {
  id: string;
  name: string;
  addedAt: number;
  lastOpenedAt: number | null;
};

export type VideoRow = {
  id: string;
  folderId: string;
  filename: string;
  driveFileId: string;
  sizeBytes: number | null;
  thumbnailUrl: string | null;
  cachedPath: string | null;
  probe: Probe | null;
};

export type MetadataRow = {
  videoId: string;
  comments: string;
  keywords: string[];
  description: string;
  people: string[];
  goodTake: boolean;
  schemaVersion: number;
  unknownFields: Record<string, unknown>;
  dirty: boolean;
  syncState: SyncState;
  lastPublishedAt: number | null;
};

export type PendingSaveRow = {
  id: string;
  videoId: string;
  op: 'upsert' | 'delete';
  payload: Canonical | null;
  confirmedAt: number;
  attempts: number;
  lastError: string | null;
  lastAttemptAt: number | null;
};

// ---------------------------------------------------------------------------
// Folders
// ---------------------------------------------------------------------------

export const folders = {
  async list(db: SQLite.SQLiteDatabase): Promise<FolderRow[]> {
    return db.getAllAsync<FolderRow>(
      'SELECT id, name, addedAt, lastOpenedAt FROM folders ORDER BY lastOpenedAt DESC, addedAt DESC',
    );
  },

  async add(db: SQLite.SQLiteDatabase, id: string, name: string): Promise<void> {
    await db.runAsync(
      'INSERT OR REPLACE INTO folders (id, name, addedAt, lastOpenedAt) VALUES (?, ?, ?, ?)',
      [id, name, Date.now(), null],
    );
  },

  async touch(db: SQLite.SQLiteDatabase, id: string): Promise<void> {
    await db.runAsync('UPDATE folders SET lastOpenedAt = ? WHERE id = ?', [Date.now(), id]);
  },

  async remove(db: SQLite.SQLiteDatabase, id: string): Promise<void> {
    // ON DELETE CASCADE removes the folder's videos, and with them their
    // metadata, markers and pending saves. That is a deliberate, explicit user
    // action (Principle II allows exactly this: destructive operations are fine
    // when the user asked for them; they are never side effects).
    await db.runAsync('DELETE FROM folders WHERE id = ?', [id]);
  },

  async get(db: SQLite.SQLiteDatabase, id: string): Promise<FolderRow | null> {
    return db.getFirstAsync<FolderRow>(
      'SELECT id, name, addedAt, lastOpenedAt FROM folders WHERE id = ?',
      [id],
    );
  },
};

// ---------------------------------------------------------------------------
// Videos
// ---------------------------------------------------------------------------

type RawVideoRow = Omit<VideoRow, 'probe'> & { probe: string | null };

const parseVideo = (row: RawVideoRow): VideoRow => ({
  ...row,
  probe: row.probe ? (JSON.parse(row.probe) as Probe) : null,
});

export const videos = {
  async upsertMany(
    db: SQLite.SQLiteDatabase,
    folderId: string,
    items: readonly Omit<VideoRow, 'folderId' | 'cachedPath' | 'probe'>[],
  ): Promise<void> {
    await db.withTransactionAsync(async () => {
      for (const v of items) {
        // Preserve cachedPath and probe: a folder refresh must not forget that
        // we already downloaded and probed the file.
        await db.runAsync(
          `INSERT INTO videos (id, folderId, filename, driveFileId, sizeBytes, thumbnailUrl)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             filename = excluded.filename,
             driveFileId = excluded.driveFileId,
             sizeBytes = excluded.sizeBytes,
             thumbnailUrl = excluded.thumbnailUrl`,
          [v.id, folderId, v.filename, v.driveFileId, v.sizeBytes, v.thumbnailUrl],
        );
      }
    });
  },

  async listByFolder(db: SQLite.SQLiteDatabase, folderId: string): Promise<VideoRow[]> {
    const rows = await db.getAllAsync<RawVideoRow>(
      'SELECT * FROM videos WHERE folderId = ? ORDER BY filename',
      [folderId],
    );
    return rows.map(parseVideo);
  },

  async get(db: SQLite.SQLiteDatabase, id: string): Promise<VideoRow | null> {
    const row = await db.getFirstAsync<RawVideoRow>('SELECT * FROM videos WHERE id = ?', [id]);
    return row ? parseVideo(row) : null;
  },

  async setCachedPath(
    db: SQLite.SQLiteDatabase,
    id: string,
    path: string | null,
  ): Promise<void> {
    await db.runAsync('UPDATE videos SET cachedPath = ? WHERE id = ?', [path, id]);
  },

  /** Clear cachedPath for every video in a folder — called after the disk is cleared. */
  async clearCachedPaths(db: SQLite.SQLiteDatabase, folderId: string): Promise<void> {
    await db.runAsync('UPDATE videos SET cachedPath = NULL WHERE folderId = ?', [folderId]);
  },

  async setProbe(db: SQLite.SQLiteDatabase, id: string, probe: Probe): Promise<void> {
    await db.runAsync('UPDATE videos SET probe = ? WHERE id = ?', [JSON.stringify(probe), id]);
  },
};

// ---------------------------------------------------------------------------
// Metadata + markers
// ---------------------------------------------------------------------------

type RawMetadataRow = {
  videoId: string;
  comments: string;
  keywords: string;
  description: string;
  people: string;
  goodTake: number;
  schemaVersion: number;
  unknownFields: string;
  dirty: number;
  syncState: SyncState;
  lastPublishedAt: number | null;
};

type RawMarkerRow = {
  id: string;
  videoId: string;
  frame: number;
  durationFrames: number;
  name: string;
  note: string;
  color: string;
  sortIndex: number;
};

export const metadata = {
  async get(db: SQLite.SQLiteDatabase, videoId: string): Promise<MetadataRow | null> {
    const row = await db.getFirstAsync<RawMetadataRow>(
      'SELECT * FROM video_metadata WHERE videoId = ?',
      [videoId],
    );
    if (!row) return null;
    return {
      videoId: row.videoId,
      comments: row.comments,
      keywords: JSON.parse(row.keywords) as string[],
      description: row.description,
      people: JSON.parse(row.people) as string[],
      goodTake: row.goodTake === 1,
      schemaVersion: row.schemaVersion,
      unknownFields: JSON.parse(row.unknownFields) as Record<string, unknown>,
      dirty: row.dirty === 1,
      syncState: row.syncState,
      lastPublishedAt: row.lastPublishedAt,
    };
  },

  async getMarkers(db: SQLite.SQLiteDatabase, videoId: string): Promise<Marker[]> {
    const rows = await db.getAllAsync<RawMarkerRow>(
      'SELECT * FROM markers WHERE videoId = ? ORDER BY frame, sortIndex, id',
      [videoId],
    );
    return rows.map((r) => ({
      id: r.id,
      frame: r.frame,
      durationFrames: r.durationFrames,
      name: r.name,
      note: r.note,
      color: r.color as MarkerColor,
      sortIndex: r.sortIndex,
    }));
  },

  /**
   * Write metadata and markers together, in one transaction.
   *
   * Markers are replaced wholesale rather than diffed: the editor owns the full
   * set, and a partial update is a way to lose one.
   */
  async save(
    db: SQLite.SQLiteDatabase,
    input: {
      videoId: string;
      comments: string;
      keywords: readonly string[];
      description?: string;
      people?: readonly string[];
      goodTake?: boolean;
      markers: readonly Marker[];
      unknownFields?: Record<string, unknown>;
      syncState: SyncState;
      dirty: boolean;
      lastPublishedAt?: number | null;
    },
  ): Promise<void> {
    await db.withTransactionAsync(async () => {
      await db.runAsync(
        `INSERT INTO video_metadata
           (videoId, comments, keywords, description, people, goodTake, schemaVersion, unknownFields, dirty, syncState, lastPublishedAt)
         VALUES (?, ?, ?, ?, ?, ?, 2, ?, ?, ?, ?)
         ON CONFLICT(videoId) DO UPDATE SET
           comments = excluded.comments,
           keywords = excluded.keywords,
           description = excluded.description,
           people = excluded.people,
           goodTake = excluded.goodTake,
           schemaVersion = excluded.schemaVersion,
           unknownFields = excluded.unknownFields,
           dirty = excluded.dirty,
           syncState = excluded.syncState,
           lastPublishedAt = COALESCE(excluded.lastPublishedAt, video_metadata.lastPublishedAt)`,
        [
          input.videoId,
          input.comments,
          JSON.stringify([...input.keywords].sort()),
          input.description ?? '',
          JSON.stringify([...(input.people ?? [])].sort()),
          input.goodTake ? 1 : 0,
          JSON.stringify(input.unknownFields ?? {}),
          input.dirty ? 1 : 0,
          input.syncState,
          input.lastPublishedAt ?? null,
        ],
      );

      await db.runAsync('DELETE FROM markers WHERE videoId = ?', [input.videoId]);
      for (const m of input.markers) {
        await db.runAsync(
          `INSERT INTO markers (id, videoId, frame, durationFrames, name, note, color, sortIndex)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            m.id,
            input.videoId,
            m.frame,
            m.durationFrames ?? 0,
            m.name ?? '',
            m.note ?? '',
            m.color,
            m.sortIndex ?? 0,
          ],
        );
      }

      // Keyword index, rebuilt from the authored set (FR-011 filter, offline).
      await db.runAsync('DELETE FROM video_keywords WHERE videoId = ?', [input.videoId]);
      for (const keyword of new Set(input.keywords)) {
        await db.runAsync(
          'INSERT OR IGNORE INTO video_keywords (videoId, keyword) VALUES (?, ?)',
          [input.videoId, keyword],
        );
      }
    });
  },

  async setSyncState(
    db: SQLite.SQLiteDatabase,
    videoId: string,
    syncState: SyncState,
    lastPublishedAt?: number,
  ): Promise<void> {
    await db.runAsync(
      `UPDATE video_metadata
       SET syncState = ?, lastPublishedAt = COALESCE(?, lastPublishedAt), dirty = CASE WHEN ? = 'published' THEN 0 ELSE dirty END
       WHERE videoId = ?`,
      [syncState, lastPublishedAt ?? null, syncState, videoId],
    );
  },

  /** Remove a video's authored metadata entirely — clear-and-save (FR-029a). */
  async clear(db: SQLite.SQLiteDatabase, videoId: string): Promise<void> {
    await db.withTransactionAsync(async () => {
      await db.runAsync('DELETE FROM markers WHERE videoId = ?', [videoId]);
      await db.runAsync('DELETE FROM video_keywords WHERE videoId = ?', [videoId]);
      await db.runAsync('DELETE FROM video_metadata WHERE videoId = ?', [videoId]);
    });
  },

  /** Which videos in a folder have metadata — drives the list badge (FR-003). */
  async videoIdsWithMetadata(
    db: SQLite.SQLiteDatabase,
    folderId: string,
  ): Promise<Set<string>> {
    const rows = await db.getAllAsync<{ videoId: string }>(
      `SELECT m.videoId FROM video_metadata m
       JOIN videos v ON v.id = m.videoId
       WHERE v.folderId = ?`,
      [folderId],
    );
    return new Set(rows.map((r) => r.videoId));
  },
};

// ---------------------------------------------------------------------------
// Keywords
// ---------------------------------------------------------------------------

export const keywords = {
  async listForFolder(db: SQLite.SQLiteDatabase, folderId: string): Promise<string[]> {
    const rows = await db.getAllAsync<{ keyword: string }>(
      `SELECT DISTINCT k.keyword FROM video_keywords k
       JOIN videos v ON v.id = k.videoId
       WHERE v.folderId = ? ORDER BY k.keyword`,
      [folderId],
    );
    return rows.map((r) => r.keyword);
  },

  async videoIdsWithKeyword(
    db: SQLite.SQLiteDatabase,
    folderId: string,
    keyword: string,
  ): Promise<Set<string>> {
    const rows = await db.getAllAsync<{ videoId: string }>(
      `SELECT k.videoId FROM video_keywords k
       JOIN videos v ON v.id = k.videoId
       WHERE v.folderId = ? AND k.keyword = ?`,
      [folderId, keyword],
    );
    return new Set(rows.map((r) => r.videoId));
  },
};

// ---------------------------------------------------------------------------
// Pending saves
// ---------------------------------------------------------------------------

type RawPendingRow = Omit<PendingSaveRow, 'payload'> & { payload: string };

export const pendingSaves = {
  /**
   * Queue a confirmed save. One row per video: a later save supersedes an
   * earlier unpublished one (last-write-wins, which the spec accepts as a
   * single-user consequence).
   *
   * Note what this does NOT have: any way to drop a row on failure. Principle
   * II — "There is no path from pending to dropped." Removal happens only in
   * `resolve` (success) and `discard` (the user said so).
   */
  async enqueue(
    db: SQLite.SQLiteDatabase,
    input: { videoId: string; op: 'upsert' | 'delete'; payload: Canonical | null },
  ): Promise<void> {
    await db.runAsync(
      `INSERT INTO pending_saves (id, videoId, op, payload, confirmedAt, attempts)
       VALUES (?, ?, ?, ?, ?, 0)
       ON CONFLICT(videoId) DO UPDATE SET
         op = excluded.op,
         payload = excluded.payload,
         confirmedAt = excluded.confirmedAt,
         attempts = 0,
         lastError = NULL`,
      [
        `ps_${input.videoId}`,
        input.videoId,
        input.op,
        JSON.stringify(input.payload),
        Date.now(),
      ],
    );
  },

  async list(db: SQLite.SQLiteDatabase): Promise<PendingSaveRow[]> {
    const rows = await db.getAllAsync<RawPendingRow>(
      'SELECT * FROM pending_saves ORDER BY confirmedAt',
    );
    return rows.map((r) => ({
      ...r,
      payload: r.payload ? (JSON.parse(r.payload) as Canonical) : null,
    }));
  },

  async count(db: SQLite.SQLiteDatabase): Promise<number> {
    const row = await db.getFirstAsync<{ n: number }>(
      'SELECT COUNT(*) AS n FROM pending_saves',
    );
    return row?.n ?? 0;
  },

  /** Success — the only automatic exit from the queue. */
  async resolve(db: SQLite.SQLiteDatabase, videoId: string): Promise<void> {
    await db.runAsync('DELETE FROM pending_saves WHERE videoId = ?', [videoId]);
  },

  /**
   * Failure. The row STAYS. We record why and count the attempt so the UI can
   * surface the cause (FR-038) and the engine can back off.
   */
  async recordFailure(
    db: SQLite.SQLiteDatabase,
    videoId: string,
    error: string,
  ): Promise<void> {
    await db.runAsync(
      `UPDATE pending_saves
       SET attempts = attempts + 1, lastError = ?, lastAttemptAt = ?
       WHERE videoId = ?`,
      [error, Date.now(), videoId],
    );
  },

  /** The user explicitly discarded this save. The only other way out. */
  async discard(db: SQLite.SQLiteDatabase, videoId: string): Promise<void> {
    await db.runAsync('DELETE FROM pending_saves WHERE videoId = ?', [videoId]);
  },

  async videoIdsPending(db: SQLite.SQLiteDatabase): Promise<Set<string>> {
    const rows = await db.getAllAsync<{ videoId: string }>(
      'SELECT videoId FROM pending_saves',
    );
    return new Set(rows.map((r) => r.videoId));
  },
};
