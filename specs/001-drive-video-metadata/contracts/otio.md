# Contract: OTIO Projection (`<filename>.otio`)

**Status**: ✅ **CONFIRMED** against DaVinci Resolve on real 23.976 footage (2026-07-17). Markers verified 1:1 on exact frames including boundaries. See research.md §S1-c.
**Path**: `<same folder as video>/<full video filename>.otio` — e.g. `A001_C001.mp4.otio`

Carries the frame-accurate markers to Resolve. **The only path markers take into the editor** (FR-031) — verified: an OTIO-only import produces markers but leaves Comments/Keywords empty, so the CSV is not redundant.

## Why OTIO fits — now verified

OTIO's `RationalTime` is `{value, rate}` — the integer-frame-plus-exact-rate pair FR-016 mandates. Marker frame `N` becomes `RationalTime(value: N + tcBase, rate)` with **no rounding**.

**The float-rate risk is retired.** OTIO's `rate` is a **float**, not a rational pair, and this was flagged as the single highest-risk line in the plan: `24000/1001 → 23.976023976023978`. Resolve reconstructs exact frames from it correctly — markers at frames 0, 123, and 246 landed on `00:00:00:00`, `00:00:05:03`, and `00:00:10:06` exactly, on genuine 23.976 footage. Resolve's Load OTIO dialog even derives and displays 23.976 from our value.

Still: **emit the full double expansion, never a truncated `23.976`**. The precision that survives is the precision we send.

## Pinned schema versions (NFR-4, D12)

`Timeline.1`, `Stack.1`, `Track.1`, `Clip.1`, `ExternalReference.1`, `TimeRange.1`, `RationalTime.1`, `Marker.2`

`Marker.2` is required — it carries `name`, `color`, `marked_range`, and `metadata`.

## Shape

```json
{
  "OTIO_SCHEMA": "Timeline.1",
  "name": "A001_C001.mp4",
  "global_start_time": null,
  "tracks": {
    "OTIO_SCHEMA": "Stack.1",
    "name": "tracks",
    "children": [
      {
        "OTIO_SCHEMA": "Track.1",
        "name": "V1",
        "kind": "Video",
        "children": [
          {
            "OTIO_SCHEMA": "Clip.1",
            "name": "A001_C001.mp4",
            "source_range": {
              "OTIO_SCHEMA": "TimeRange.1",
              "start_time": {
                "OTIO_SCHEMA": "RationalTime.1",
                "value": 0,
                "rate": 23.976023976023978
              },
              "duration": {
                "OTIO_SCHEMA": "RationalTime.1",
                "value": 14414,
                "rate": 23.976023976023978
              }
            },
            "media_reference": {
              "OTIO_SCHEMA": "ExternalReference.1",
              "target_url": "A001_C001.mp4",
              "available_range": {
                "OTIO_SCHEMA": "TimeRange.1",
                "start_time": {
                  "OTIO_SCHEMA": "RationalTime.1",
                  "value": 0,
                  "rate": 23.976023976023978
                },
                "duration": {
                  "OTIO_SCHEMA": "RationalTime.1",
                  "value": 14414,
                  "rate": 23.976023976023978
                }
              }
            },
            "markers": [
              {
                "OTIO_SCHEMA": "Marker.2",
                "name": "Good bit",
                "color": "GREEN",
                "marked_range": {
                  "OTIO_SCHEMA": "TimeRange.1",
                  "start_time": {
                    "OTIO_SCHEMA": "RationalTime.1",
                    "value": 1200,
                    "rate": 23.976023976023978
                  },
                  "duration": {
                    "OTIO_SCHEMA": "RationalTime.1",
                    "value": 240,
                    "rate": 23.976023976023978
                  }
                },
                "metadata": { "note": "Best delivery of the line" }
              }
            ]
          }
        ]
      }
    ]
  }
}
```

## ⚠️ Coordinate system: media timecode, NOT 0-based offsets

**The most important rule in this contract**, and the one that broke every early import.

Resolve matches media by **timecode overlap**. Our canonical model stores marker frames as 0-based offsets from the first frame — correct, and the authority — but OTIO ranges live in the media's **timecode** coordinate space. A clip whose file starts at `18:52:38:16` must declare ranges starting at that frame (1631008), not 0. Declaring 0 makes Resolve reject the media outright:

```
Mismatch between specified target timecodes [00:00:00:00 00:00:10:07)
and located file timecodes [18:52:38:16 18:52:48:23)
No overlap between specified target timecodes ... and located file timecodes ...
```

**Rule**: `tcBase = technical.source_timecode_frames ?? 0`, added to `available_range.start_time`, `source_range.start_time`, and **every** `marked_range.start_time`.

⚠️ **The error message lies.** Resolve reports *"The clip was not found. Do you want to select another folder to search?"* — which blames the file path when the fault is the coordinate system. It had already located the file (it reads its timecodes). **The Log window carries the truth; the modal does not.** This cost several wrong hypotheses (URL form, filename case, absolute vs relative paths). If media "isn't found", check timecode overlap before touching paths.

## Mapping from canonical

| Canonical | OTIO |
|---|---|
| `identity.filename` | `Timeline.name`, `Clip.name`, `ExternalReference.target_url` |
| `technical.frame_rate` | every `RationalTime.rate` (full float expansion) |
| `technical.source_timecode_frames` | **`tcBase` — added to every `start_time`** |
| `technical.duration_frames` | `source_range.duration.value`, `available_range.duration.value` |
| `markers[].frame` | `marked_range.start_time.value` = **`tcBase + frame`** |
| `markers[].duration_frames` | `marked_range.duration.value` (`0` for point markers) |
| `markers[].name` | `Marker.name` |
| `markers[].note` | `Marker.metadata.note` — ⚠️ still unverified |
| `markers[].color` | `Marker.color` (D10 palette) |

**Markers hang off the `Clip`, not the `Track`** — they're properties of the source media, which is what makes them map back to source frames 1:1 (SC-001). Confirmed: markers share the clip's media-timecode coordinate space.

`target_url` is a **bare relative filename** — ✅ **confirmed to link silently**, with no prompt to locate media, when the `.otio` sits beside the video. This is what the product needs: the app writes sidecars on iOS and the user downloads the folder to an arbitrary path, so an absolute path could never be right. (The early failures with a relative name were the timecode bug above, not the path.)

## Writer contract

- Pure function of canonical. Deterministic key order, markers ordered by `(frame, sortIndex, id)` (SC-010).
- Written **before** the canonical `.json` (D9).
- **Refuse to emit markers when `rate_mode !== 'constant'`** — the canonical will already have none (FR-019a). Writing an approximate marker here would defeat every other safeguard.
- No OTIO library: this is hand-emitted JSON (D12).

## S1 results

| # | Question | Result |
|---|---|---|
| 1 | Markers on exact frames, incl. frame 0 and last | ✅ 0/123/246 → `00:00:00:00` / `00:00:05:03` / `00:00:10:06` |
| 2 | Does Resolve recover exact frames from the float rate? | ✅ Yes — 23.976 reconstructed correctly |
| 3 | Range markers survive? | ✅ 24-frame range → `00:00:01:00` |
| 4 | Schema tags accepted (`Clip.1`, `Marker.2`, …) | ✅ Native "Load OTIO" importer accepts them |
| 5 | Relative `target_url` links? | ✅ Silently, no prompt |
| 6 | Does OTIO carry comments/keywords? | ❌ No — CSV required (FR-031 confirmed) |
| 7 | Note read from `metadata.note`? | ⚠️ **Untested** |
| 8 | Which palette colours survive? | ⚠️ Red/Green/Blue confirmed; rest untested |

**Also learned**: timeline resolution is not an OTIO concept — Resolve inherits it from project settings, so there is nothing for us to emit. The timeline we create is a *vehicle* for the markers, not a deliverable; its name, resolution, and start timecode don't matter.

## Remaining open items (non-blocking)

- **Marker notes** (`metadata.note`): unverified. If Resolve ignores it, fold the note into `Marker.name` — the generator has a `--note-in-name` variant ready.
- **Colours beyond Red/Green/Blue**: Cyan, Yellow, Pink, Purple untested; verify the D10 palette round-trips before relying on it.
