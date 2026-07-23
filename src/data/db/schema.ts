/**
 * SQLite schema and migration ladder. See data-model.md.
 *
 * This store is durable by design, not by convenience. Principle II: metadata
 * confirmed offline must survive app and device restarts, so it lives here
 * rather than in memory or in the video cache — which the OS may purge and the
 * user may clear.
 */

import * as SQLite from 'expo-sqlite';

export const DB_NAME = 'rushmark.db';

/**
 * Each migration is applied once, in order, tracked by SQLite's own
 * `user_version`. Append only — never edit a shipped migration, or a device that
 * already ran it will silently diverge from one that has not.
 */
const MIGRATIONS: readonly string[] = [
  // v1 — initial schema (data-model.md)
  `
  CREATE TABLE folders (
    id TEXT PRIMARY KEY, name TEXT NOT NULL,
    addedAt INTEGER NOT NULL, lastOpenedAt INTEGER
  );

  CREATE TABLE videos (
    id TEXT PRIMARY KEY,
    folderId TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    driveFileId TEXT NOT NULL,
    sizeBytes INTEGER, thumbnailUrl TEXT, cachedPath TEXT,
    probe TEXT,
    UNIQUE(folderId, filename)
  );

  CREATE TABLE video_metadata (
    videoId TEXT PRIMARY KEY REFERENCES videos(id) ON DELETE CASCADE,
    comments TEXT NOT NULL DEFAULT '',
    keywords TEXT NOT NULL DEFAULT '[]',
    schemaVersion INTEGER NOT NULL DEFAULT 1,
    unknownFields TEXT NOT NULL DEFAULT '{}',
    provenance TEXT NOT NULL DEFAULT 'manual',
    dirty INTEGER NOT NULL DEFAULT 0,
    syncState TEXT NOT NULL DEFAULT 'local-only',
    lastPublishedAt INTEGER
  );

  CREATE TABLE markers (
    id TEXT PRIMARY KEY,
    videoId TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    frame INTEGER NOT NULL,
    durationFrames INTEGER NOT NULL DEFAULT 0,
    name TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL,
    sortIndex INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_markers_video ON markers(videoId, frame, sortIndex);

  CREATE TABLE pending_saves (
    id TEXT PRIMARY KEY,
    videoId TEXT NOT NULL UNIQUE REFERENCES videos(id) ON DELETE CASCADE,
    op TEXT NOT NULL,
    payload TEXT NOT NULL,
    confirmedAt INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    lastError TEXT, lastAttemptAt INTEGER
  );

  CREATE TABLE video_keywords (
    videoId TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    keyword TEXT NOT NULL,
    PRIMARY KEY (videoId, keyword)
  );
  CREATE INDEX idx_keywords ON video_keywords(keyword);
  `,
  // v2 — richer whole-video metadata (Description, People, Good Take). Additive:
  // existing rows default to empty, so no data is touched. schemaVersion in the
  // canonical is bumped separately in src/domain/canonical.ts.
  `
  ALTER TABLE video_metadata ADD COLUMN description TEXT NOT NULL DEFAULT '';
  ALTER TABLE video_metadata ADD COLUMN people TEXT NOT NULL DEFAULT '[]';
  ALTER TABLE video_metadata ADD COLUMN goodTake INTEGER NOT NULL DEFAULT 0;
  `,
];

export async function migrate(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync('PRAGMA foreign_keys = ON;');

  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version;');
  const current = row?.user_version ?? 0;

  for (let version = current; version < MIGRATIONS.length; version += 1) {
    const sql = MIGRATIONS[version];
    if (!sql) continue;
    await db.withTransactionAsync(async () => {
      await db.execAsync(sql);
    });
    // PRAGMA does not accept a bound parameter, and `version + 1` is a number we
    // computed from the loop bound — not user input.
    await db.execAsync(`PRAGMA user_version = ${version + 1};`);
  }
}

let cached: SQLite.SQLiteDatabase | null = null;

export async function openDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (cached) return cached;
  const db = await SQLite.openDatabaseAsync(DB_NAME);
  await migrate(db);
  cached = db;
  return db;
}

/** Test seam: drop the cached handle so a fresh in-memory DB can be opened. */
export function resetDatabaseHandle(): void {
  cached = null;
}
