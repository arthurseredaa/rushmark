# Phase 1: Data Model

**Feature**: Drive Video Metadata Producer | **Date**: 2026-07-16

Derives from the spec's Key Entities. Three stores, with a strict rule about which owns what:

| Store | Holds | Durability |
|---|---|---|
| **SQLite** (`Documents/app.db`) | Folders, canonical metadata, markers, pending saves, unknown fields | Durable. Holds unpublished work. Never auto-cleared. |
| **Filesystem** (`Documents/video-cache/`) | Video originals | Kept until user clears (FR-010). Rebuildable from Drive. |
| **Google Drive** | Published sidecars | Remote. Publish target, not the read path. |

**The load-bearing separation** (FR-036): clearing the video cache is a filesystem operation and *cannot* reach the database. Unpublished work survives cache clearing by construction, not by careful coding.

---

## Core value type: `Rational` — exact frame rate

The type everything else depends on. A frame rate is **never** a float.

```ts
type Rational = { num: number; den: number };  // 24000/1001, not 23.976

// From AVFoundation's CMTime(minFrameDuration): rate = timescale/value
// 23.976 → { num: 24000, den: 1001 }
// 60     → { num: 60, den: 1 }
```

**Rules** (enforced in `src/domain/rational.ts`):
- `num > 0`, `den > 0`; stored in lowest terms for canonical determinism (SC-010).
- Frame → time only at the AVFoundation boundary, via `CMTime`, never through JS floats.
- Equality is `num*other.den === other.num*den`. Never compare as floats.
- A `Rational` is never divided into a float for storage, display of a *position*, or export.

---

## Entities

### Folder

A connected Drive folder.

| Field | Type | Notes |
|---|---|---|
| `id` | TEXT PK | Drive folder ID |
| `name` | TEXT | Display name |
| `addedAt` | INTEGER | epoch ms |
| `lastOpenedAt` | INTEGER? | for ordering the folder list |

Relationships: has many `Video`. Deleting a folder deletes its videos, metadata, markers, and cached files — but **is blocked while it has pending saves** (would destroy unpublished work).

---

### Video

One video file in a folder. **Identity is `filename`**, per the clarification — `driveFileId` is only a locator.

| Field | Type | Notes |
|---|---|---|
| `id` | TEXT PK | local surrogate: `<folderId>:<filename>` |
| `folderId` | TEXT FK | → Folder |
| `filename` | TEXT | **The identity.** Full name incl. extension (FR-021a) |
| `driveFileId` | TEXT | Locator only. May change; not identity |
| `sizeBytes` | INTEGER | for the cellular prompt (FR-006a) |
| `thumbnailUrl` | TEXT? | Drive `thumbnailLink` (FR-004) |
| `cachedPath` | TEXT? | non-null ⟺ available offline |
| `probe` | JSON? | technical facts, below. Null until first open |

**UNIQUE(`folderId`, `filename`)** — enforces filename identity in the schema itself.

**Consequences of filename identity** (accepted in clarification):
- Rename in Drive → new `filename` → no metadata match → opens empty; old rows and sidecars orphan. Never auto-deleted.
- New file reusing a deleted file's name inherits its metadata.

#### `probe` — technical facts (FR-011, read-only)

```ts
type Probe = {
  codec: string;                    // "avc1", "hvc1"
  width: number; height: number;
  frameRate: Rational | null;       // null → rate undeterminable (FR-019)
  durationFrames: number | null;    // integer frames; marker bounds
  sourceTimecodeFrames: number | null;  // null = ABSENT, not zero (FR-012, D4)
  rateMode: 'constant' | 'variable' | 'unknown';  // (FR-019a, D3)
};
```

**`rateMode` is the gate for marker authoring:**

| `rateMode` | `frameRate` | Markers | Comments/Keywords | Requirement |
|---|---|---|---|---|
| `constant` | non-null | ✅ | ✅ | normal path |
| `variable` | non-null | ❌ disabled + explained | ✅ | FR-019a |
| `unknown` | null | ❌ refused + explained | ✅ | FR-019 |

`sourceTimecodeFrames: null` means **absent**, never "starts at zero" — the distinction is meaningful to an editor.

---

### VideoMetadata (canonical)

The source-of-truth record. What the user edits against; published as `.json`.

| Field | Type | Notes |
|---|---|---|
| `videoId` | TEXT PK FK | → Video |
| `comments` | TEXT | free text (FR-013), default `''` |
| `keywords` | JSON | `string[]` (FR-014), default `[]` |
| `description` | TEXT | free text, distinct from comments (FR-014a, schema v2), default `''` |
| `people` | JSON | `string[]` (FR-014a, schema v2), default `[]` |
| `goodTake` | INTEGER | 0/1 Good Take flag (FR-014a, schema v2), default `0` |
| `schemaVersion` | INTEGER | as read; diagnostic only (FR-023a, D11). Written as **2** |
| `unknownFields` | JSON | **verbatim unrecognized fields (FR-023b)** |
| `provenance` | TEXT | `'manual'` — all v1 authoring (FR-018) |
| `dirty` | INTEGER | 1 = unsaved changes (FR-029) |
| `syncState` | TEXT | `synced` \| `pending` \| `failed` \| `local-only` |
| `lastPublishedAt` | INTEGER? | null = never reached Drive |

`unknownFields` is what makes lenient reading safe (D11): fields this build doesn't understand are parked here and merged back on write, so an older build can't silently delete a newer build's data. Verified by SC-013.

**Emptiness** — drives the clear-and-save deletion (FR-029a):

```
isEmpty = comments.trim() === '' && keywords.length === 0 && markers.length === 0
```

`unknownFields` is deliberately **excluded** from that test: a record holding only unrecognized fields counts as **non-empty**, so its sidecars are preserved rather than deleted (spec edge case). Deleting a file because we didn't understand it would be the worst possible reading of "empty".

---

### Marker

| Field | Type | Notes |
|---|---|---|
| `id` | TEXT PK | local uuid |
| `videoId` | TEXT FK | → Video |
| `frame` | INTEGER | **integer offset** (FR-016). Never a float |
| `durationFrames` | INTEGER | 0 = point, >0 = range (FR-017) |
| `name` | TEXT | |
| `note` | TEXT | |
| `color` | TEXT | one of the D10 palette |
| `sortIndex` | INTEGER | deterministic export order (SC-010) |

The rate is **not** stored per marker — it lives on the video's `probe`, and duplicating it would let the two drift. A marker is `(frame, durationFrames)` interpreted against the video's exact rate; together they satisfy "integer frame offset paired with the exact rate".

**Validation** (`src/domain/markers.ts`):
- `frame` integer, `0 ≤ frame < durationFrames` (video's) — boundary case in spike S1.
- `durationFrames ≥ 0`, and `frame + durationFrames ≤ video.durationFrames` (range can't exceed end).
- Multiple markers may share a frame (spec: both kept and exported).
- Colors restricted to the palette (D10).
- **Rejected entirely if `rateMode !== 'constant'`** — the app must not hold a marker it can't export truthfully.

**Ordering** for export: `(frame, sortIndex, id)` — total and stable, so identical content yields byte-identical output (SC-010).

---

### PendingSave

A confirmed save that hasn't reached Drive (FR-034). The offline queue.

| Field | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `videoId` | TEXT FK | → Video |
| `op` | TEXT | `publish` \| `delete` (FR-029a deletion queues too) |
| `payload` | JSON | canonical snapshot **frozen at confirm time** |
| `confirmedAt` | INTEGER | when the user tapped the checkmark |
| `attempts` | INTEGER | |
| `lastError` | TEXT? | surfaced, not swallowed (FR-038) |
| `lastAttemptAt` | INTEGER? | backoff |

**UNIQUE(`videoId`)** — one pending save per video; re-confirming replaces the payload (last write wins).

`payload` is a **snapshot, not a reference**. The user's confirm captured a specific state; if they keep editing afterwards, that's a new save. Publishing live-mutating state would let a save publish something never confirmed — violating FR-024's core promise that nothing is published without confirmation.

**States** (SC-016 — nothing lost across restarts):

```
(confirm) → pending ──publish ok──→ [dequeued] → synced
               ↑                        │
               └──── failure ───────────┘   attempts++, lastError set,
                                            STAYS QUEUED (FR-038)
```

There is no transition from `pending` to discarded. The only exits are success or explicit user discard.

---

## SQLite schema

```sql
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
  UNIQUE(folderId, filename)          -- filename identity (FR-021a)
);

CREATE TABLE video_metadata (
  videoId TEXT PRIMARY KEY REFERENCES videos(id) ON DELETE CASCADE,
  comments TEXT NOT NULL DEFAULT '',
  keywords TEXT NOT NULL DEFAULT '[]',
  description TEXT NOT NULL DEFAULT '',   -- schema v2 (migration ladder v2)
  people TEXT NOT NULL DEFAULT '[]',      -- schema v2
  goodTake INTEGER NOT NULL DEFAULT 0,    -- schema v2
  schemaVersion INTEGER NOT NULL DEFAULT 1,
  unknownFields TEXT NOT NULL DEFAULT '{}',   -- FR-023b
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

-- Keyword filter/sort without network (FR-005), offline included
CREATE TABLE video_keywords (
  videoId TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  keyword TEXT NOT NULL,
  PRIMARY KEY (videoId, keyword)
);
CREATE INDEX idx_keywords ON video_keywords(keyword);
```

`video_keywords` denormalizes the `keywords` JSON so filtering is an indexed query rather than a scan of every row's JSON. Rewritten inside the same transaction as `video_metadata`, so the two can't diverge.

**Transaction boundaries** — a save is one transaction: update `video_metadata` + replace `markers` + rebuild `video_keywords` + upsert `pending_saves` + clear `dirty`. Either the confirm is fully recorded or nothing changed. This is what makes "confirmed offline" durable (FR-035) before any network exists.

---

## Sync state machine (per video)

```
local-only ──confirm──→ pending ──publish ok──→ synced
                          │  ↑                    │
                   fail   │  │ confirm again      │ confirm
                          ↓  │                    ↓
                        failed ─── retry ───→ pending
```

- `local-only`: authored, never published. Not an error — just not yet.
- `pending`: confirmed, queued. **Never silently leaves this state except by success.**
- `failed`: last attempt failed; `lastError` shown. Still queued (FR-038); retried on reconnect.
- `synced`: Drive matches the last confirm.

Publishing per D9: projections first, canonical `.json` **last** — a stale projection beside an old `.json` is a consistent old state, whereas `.json`-first would advertise a state the projections don't reflect.

---

## Requirements traceability

| Requirement | Where it lives |
|---|---|
| FR-016 exact frames | `Rational`, `Marker.frame` INTEGER; no float path |
| FR-019 / FR-019a gates | `Probe.rateMode` + marker rejection |
| FR-012 timecode absence | `sourceTimecodeFrames: null` ≠ 0 |
| FR-021a filename identity | `UNIQUE(folderId, filename)` |
| FR-023b field preservation | `unknownFields` blob, merged on write |
| FR-029a clear-and-save | `isEmpty` excl. `unknownFields` → `op: 'delete'` |
| FR-035 durable queue | `pending_saves` in SQLite, single transaction |
| FR-036 cache ≠ work | DB vs filesystem separation |
| FR-038 no discard | no `pending → discarded` edge |
| FR-005 offline filter | `video_keywords` index |
| SC-010 determinism | lowest-terms `Rational` + total marker ordering |
