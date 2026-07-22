# Phase 0 spike — Resolve round-trip

**Status: ✅ PASSED (2026-07-17)** — verified against DaVinci Resolve on real 23.976 DJI footage.

This folder holds the *verified output* of the spike that gated implementation. Full findings: [`specs/001-drive-video-metadata/research.md`](../specs/001-drive-video-metadata/research.md) §S1-a…S1-d.

## What's here

- `media/*.json`, `*.csv`, `*.otio` — the exact sidecars that imported cleanly into Resolve. Reference output: when a refactor breaks a writer, diff against these.
- `media/*.MP4` — **git-ignored.** The source clip was 68 MB of personal footage; git would keep it in history forever, and nothing here needs it committed.

The sidecars describe a video not in the repo. That's intentional — they're kept as evidence of the confirmed format, not as a runnable fixture. To reproduce end to end, drop any clip in and regenerate.

## Reproduce

```bash
# Drop a video into spike/media/, then:
node tools/sidecar-gen/generate.js spike/media/<your-clip>.MP4 --markers 0,middle,last
```

Sidecars are written next to the video (the `.otio`'s relative `target_url` needs that).

Useful flags: `--url-form absolute|name|dot`, `--marker-base tc|zero`, `--csv-variant`, `--note-in-name`, `--bom`, `--dry-run`.

## Importing into Resolve

1. **Project Settings → Timeline frame rate = 23.976** *before* importing anything. Resolve locks it once media is in the pool; getting it wrong shifts every marker and produces a false failure.
2. **File → Import → Timeline** → the `.otio`. Creates a timeline with the markers and pulls the video in. Links silently from the relative filename.
3. **Media Pool → Import Metadata** → the `.csv`. Works with **default** options.
4. Read the results on the **Media page** → Metadata → **Shot & Scene**. The Edit page's Metadata panel shows *Clip Details* only and will look like a failed import.

## What was confirmed

| | |
|---|---|
| Markers | 1:1 on exact frames — 0/123/246 → `00:00:00:00` / `00:00:05:03` / `00:00:10:06`, incl. first and last frame |
| Range markers | 24-frame range → `00:00:01:00`, duration intact |
| OTIO float `rate` | Lossless for `24000/1001` — the plan's biggest risk, retired |
| CSV headers | `File Name`, `Comments`, `Keywords` (+ `Start TC`, `End TC`) |
| Keywords | Comma-space separator → separate keyword chips |
| Media linking | Bare relative filename links silently |
| Both files needed | OTIO carries markers but no comments/keywords; CSV carries no markers |

## Traps (each cost real time)

**OTIO ranges are in media-timecode coordinates, not 0-based offsets.** A file starting at `18:52:38:16` must declare ranges from frame 1631008. Resolve matches media by timecode overlap and rejects non-overlapping clips with **"The clip was not found"** — blaming file paths for a timecode fault. It had already located the file. **The importer's Log window carries the real reason; the modal does not.** This sent us chasing URL forms, filename case, and absolute paths for an hour.

**A UTF-8 BOM breaks CSV matching.** Its bytes attach to the first header, so Resolve reads `<BOM>File Name`, can't identify the match column, and reports *"No matching media pool entries were found"*.

**`Start TC`/`End TC` columns are why the CSV imports with default settings.** Resolve ships with "Match using clip start and end Timecode" ticked; a CSV without those columns matches nothing and blames the media pool.

## Still open (non-blocking)

- **Marker notes**: does Resolve read `Marker.metadata.note`? Untested. Fallback ready: `--note-in-name` here, `noteInName` in `src/domain/projections/otio.ts`.
- **Palette**: only Red/Green/Blue verified. Cyan, Yellow, Pink, Purple untested.
- **Non-ASCII**: the BOM protected non-Latin text and is now gone. Untested — matters if comments are ever written in Cyrillic.

These are tasks T065–T067. Each needs Resolve and real footage; each is a question the app now has a concrete answer path for.

## These files are now a test fixture

`tests/golden/projections.test.ts` reproduces all three sidecars **byte-for-byte** from `src/domain/`, using the input recorded in `tests/golden/fixtures.ts`. The spike's output is no longer just evidence — it is the regression lock on the three findings that cost the most to learn:

- an OTIO range offset by anything other than the media timecode fails the suite (F13)
- a BOM on the CSV fails the suite (F7)
- dropping `Start TC`/`End TC` fails the suite (D13a)

If you change a writer and these fail, the writer is wrong. The fixtures were confirmed by a real import.
