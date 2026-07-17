# Contract: Canonical Sidecar (`<filename>.json`)

**Status**: Stable — this is *our* format; we own it. Not spike-gated.
**Schema version**: 1
**Path**: `<same folder as video>/<full video filename>.json` — e.g. `A001_C001.mp4.json`

The source of truth (FR-022). Always written on save (FR-026). The `.csv` and `.otio` are deterministic projections of this file and are **never read back**.

## Shape

```json
{
  "schema_version": 1,
  "identity": {
    "filename": "A001_C001.mp4",
    "drive_file_id": "1a2b3c..."
  },
  "technical": {
    "codec": "avc1",
    "width": 3840,
    "height": 2160,
    "frame_rate": { "num": 24000, "den": 1001 },
    "duration_frames": 14414,
    "rate_mode": "constant",
    "source_timecode_frames": 86400
  },
  "authored": {
    "comments": "Good take. Use the wide at the top.",
    "keywords": ["interview", "wide", "day-2"]
  },
  "markers": [
    {
      "frame": 0,
      "duration_frames": 0,
      "name": "Start",
      "note": "Cut in here",
      "color": "RED"
    },
    {
      "frame": 1200,
      "duration_frames": 240,
      "name": "Good bit",
      "note": "Best delivery of the line",
      "color": "GREEN"
    }
  ],
  "provenance": {
    "authored_by": "manual",
    "app_version": "1.0.0",
    "written_at": "2026-07-16T10:30:00Z"
  }
}
```

## Field rules

| Field | Rule |
|---|---|
| `schema_version` | Always written. **Diagnostic, never a read gate** (FR-023a). A mismatch must not make a file unreadable. |
| `identity.filename` | **The identity** (FR-021a). Must equal the video's full filename incl. extension. Must match the sidecar's own name prefix. |
| `identity.drive_file_id` | Locator only. Informational; never used to match metadata to a video. |
| `technical.frame_rate` | Exact rational, lowest terms. **Never a decimal.** `null` when undeterminable. |
| `technical.duration_frames` | Integer. Marker bounds. |
| `technical.rate_mode` | `constant` \| `variable` \| `unknown`. If not `constant`, `markers` MUST be `[]` (FR-019, FR-019a). |
| `technical.source_timecode_frames` | Integer, or **`null` meaning absent** (FR-012). Never write `0` to mean "unknown". |
| `authored.comments` | Free text. `""` when empty. |
| `authored.keywords` | Array of strings. Written sorted for determinism (SC-010). |
| `markers[].frame` | **Integer** frame offset (FR-016). Never a float, never seconds. |
| `markers[].duration_frames` | `0` = point marker; `>0` = range (FR-017). |
| `markers[].color` | One of `RED`, `GREEN`, `BLUE`, `CYAN`, `YELLOW`, `PINK`, `PURPLE` (D10). |
| `provenance.authored_by` | `"manual"` in v1 (FR-018) — so future AI-generated values stay distinguishable. |

## Reader contract (FR-023a, FR-023b) — the important part

The reader is **lenient**, and leniency is only safe because of preservation:

1. Parse JSON. **Only a parse failure is "unreadable"** (FR-023) → report, don't overwrite.
2. Ignore `schema_version` for gating. Read every recognized field.
3. **Retain every unrecognized key verbatim** — at any depth — in `unknownFields`.
4. If anything was unrecognized, show the small warning (FR-023a).
5. On write, **deep-merge the retained keys back**, with app-authored fields winning.

Without step 5, step 2 is a data-loss bug: an older build would read a newer file, ignore what it didn't know, and silently delete those fields on save. Verified byte-for-byte by SC-013.

## Writer contract

- **Deterministic** (SC-010): stable key order as shown; keywords sorted; markers ordered by `(frame, sortIndex, id)`. Identical content → byte-identical output.
- `frame_rate` reduced to lowest terms before writing.
- Written **last** of the three sidecars (D9): a stale projection beside an old canonical is a consistent old state.
- `written_at` is metadata *about* the write, so two saves of identical content differ here. Golden tests inject a fixed clock; determinism is asserted over everything else.

## Emptiness → deletion (FR-029a)

A record is empty when `comments` is blank AND `keywords` is empty AND `markers` is empty. Empty + save → **delete all three sidecars** rather than write this file.

`unknownFields` is excluded from that test: a file containing only unrecognized keys is **non-empty**, and its sidecars are preserved. Deleting a file because we failed to understand it is the worst available reading of "empty".
