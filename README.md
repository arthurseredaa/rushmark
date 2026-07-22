# Rushmark

Frame-accurate video metadata authoring for iOS, writing back to Google Drive.

Connect a Drive folder of footage, preview clips frame-accurately on your phone, and
author comments, keywords, and frame-exact markers. Saving writes three sidecar files
next to each video in Drive — ready to import into DaVinci Resolve.

Personal, single-user, client-only. No backend.

---

## What it produces

For a video `A001_C001.mp4`, an explicit save writes three files into the same Drive
folder:

| File | Role |
| --- | --- |
| `A001_C001.mp4.json` | **Canonical model** — identity, technical facts, comments, keywords, markers, provenance. The source of truth. |
| `A001_C001.mp4.csv` | Resolve whole-video metadata (Comments, Keywords). |
| `A001_C001.mp4.otio` | OpenTimelineIO timeline carrying the frame-accurate markers. |

The `.csv` and `.otio` are deterministic **projections** of the canonical JSON — never
authored into, never read back, always regenerable. Identical canonical content
produces byte-identical projections.

A known and accepted loss: CSV cannot carry markers. Markers reach Resolve via OTIO
only, which is why both files are written.

## Correctness, briefly

Frame rates are exact rationals — `24000/1001`, never `23.976`. Marker positions are
integer frame offsets paired with that exact rate, and no float enters any frame path.
Where a rate can't be determined, or footage is variable-rate, the app refuses the
operation and says so rather than guessing.

This isn't fussiness: a camera reporting "24 fps" is usually really 23.976, and a
round-trip validated against real DJI footage proved 1:1 frame mapping is achievable.
Any deviation is therefore a defect, not a tolerance.

The full rules live in [`.specify/memory/constitution.md`](./.specify/memory/constitution.md).

---

## Getting started

**→ [SETUP.md](./SETUP.md)** walks through Google OAuth credentials and the first
build. Budget ~15 minutes; you only do it once.

The short version, once credentials exist:

```bash
npm install
cp .env.example .env      # fill in your Google OAuth client IDs
npx expo prebuild -p ios
npx expo run:ios          # choose an iPhone simulator
```

Rushmark bundles a custom native module for frame-accurate playback, so **Expo Go
cannot run it** — every path builds a dev client.

`.env` is read at build time, not runtime. After changing it, re-run `prebuild` and
rebuild; a Metro reload won't pick it up.

## Development

```bash
npm start           # Metro (dev client)
npm test            # Jest
npm run typecheck   # tsc --noEmit
npm run lint        # ESLint
```

Tests tagged `[CONST]` enforce the constitution's principles and are mandatory.

## Layout

```
app/                    expo-router screens
src/
  data/                 Drive client, SQLite, cache, sync queue
  features/             auth, folders, library, markers, sidecars
  ui/                   providers, components, theme
modules/frame-player/   native AVFoundation module (Swift)
specs/                  spec, plan, data model, contracts, tasks
tools/sidecar-gen/      standalone sidecar generator (used by the spike)
```

## Requirements

- iOS 16+, macOS with Xcode 16+
- Node 20+
- A Google account with the Drive API enabled ([SETUP.md](./SETUP.md))
- DaVinci Resolve 18.6.5+ for round-trip validation

## Status

Core implementation complete. Outstanding work is tracked in
[`specs/001-drive-video-metadata/tasks.md`](./specs/001-drive-video-metadata/tasks.md) —
mostly Resolve round-trip verification that needs real footage, plus a native XCTest
target that CocoaPods' `test_spec` didn't wire up.
