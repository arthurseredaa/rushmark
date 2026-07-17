# Implementation Plan: Drive Video Metadata Producer

**Branch**: `001-drive-video-metadata` | **Date**: 2026-07-16 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-drive-video-metadata/spec.md`

## Summary

An iOS-only React Native app that connects to Google Drive folders of video, plays cached originals with frame-accurate positioning, and lets a single user author whole-video metadata (comments, keywords) and frame-accurate markers. On an explicit per-video save it publishes three sidecars next to the video in Drive: a canonical `.json` (source of truth) plus deterministic `.csv` and `.otio` projections for DaVinci Resolve. Authoring works fully offline; confirmed saves queue locally and publish automatically on reconnect.

> **Phase 0 spike: ✅ PASSED (2026-07-17)** — verified against DaVinci Resolve on the user's real 23.976 DJI footage. Markers map 1:1 onto exact frames (including frame 0 and the last frame, range durations intact); OTIO's float `rate` carries `24000/1001` losslessly, retiring the plan's biggest risk. `contracts/otio.md` and `contracts/resolve-csv.md` are confirmed, not hypotheses. **Implementation is unblocked.** See research.md §S1-a…S1-d.

**Technical approach**: Expo (bare workflow with a development client, not Expo Go — a custom native module is required). Frame accuracy is delivered by a thin native AVFoundation module exposing zero-tolerance seeking and frame stepping, because no off-the-shelf React Native player exposes the primitives that FR-007, FR-008, and SC-001 require. Local state lives in SQLite (metadata + pending save queue, durable) with video originals in the app's Documents directory (not Caches, which iOS purges under pressure — FR-010 forbids that). Drive is reached over its v3 REST API with tokens from Google Sign-In. The `.otio` and `.csv` writers are pure functions over the canonical model, built and validated by the Phase 0 spike before any app code.

## Technical Context

**Language/Version**: TypeScript 5.x on React Native 0.8x via Expo SDK 54+; Swift 5.9+ for the native module

**Primary Dependencies**: `expo`, `expo-dev-client`, `@react-native-google-signin/google-signin` (auth + access tokens for Drive REST), `expo-sqlite` (durable local store), `expo-file-system` (resumable downloads, cache management), `@react-native-community/netinfo` (reconnect detection), `expo-router` or React Navigation (screens). Google Drive v3 REST called directly over `fetch` — no `googleapis` SDK (Node-oriented, heavy, unnecessary for ~6 endpoints).

**Storage**: SQLite for canonical metadata, pending saves, folder list, and keyword index. Filesystem (`Documents/`, excluded from iCloud backup) for cached video originals. Drive holds the published sidecars.

**Testing**: Jest + `@testing-library/react-native` for logic and components; Swift XCTest for the native module's frame math; a golden-file suite pinning the `.json`/`.csv`/`.otio` writers (SC-010 determinism); manual Resolve import verification per the Phase 0 spike.

**Target Platform**: iOS 16+ (single-user personal app, no Android — spec non-goal)

**Project Type**: Mobile app, client-only. No backend, no server component.

**Performance Goals**: Frame step and seek land on the exact requested frame with zero tolerance (SC-001, SC-005 — correctness, not latency). Playback at source frame rate (24/60 fps). Video list renders and stays responsive for folders of several hundred videos. Pending saves publish within seconds of reconnect while the app is running (SC-017).

**Constraints**: Frame-exactness is non-negotiable — fail loudly rather than approximate (SC-009, SC-014). Offline-capable for all authoring (FR-032). Cached originals must survive system storage pressure (FR-010). No partial sidecar may ever be readable in Drive (FR-028). Sidecar writers must be deterministic (SC-010).

**Scale/Scope**: One user, one device. Handful of connected folders; hundreds of videos per folder; tens of markers per video. Roughly 8–10 screens.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is an **unfilled template** — every principle is still a `[PRINCIPLE_N_NAME]` placeholder with no content. There are no ratified project principles to check this design against, so no gates apply and none can fail.

**Status**: PASS (vacuously — no constitution in force).

**Recommendation**: run `/speckit-constitution` before implementation. This feature has two candidate principles that are already load-bearing in the spec and would be worth ratifying, since they are the rules most likely to be quietly traded away under pressure:

1. **Exactness over convenience** — never approximate a frame position; fail loudly and explain instead (SC-001, SC-009, SC-014, NFR-1).
2. **Never lose authored work** — offline edits, pending saves, and unrecognized sidecar fields all survive; no code path discards user input to simplify a flow (FR-023b, FR-035, FR-038).

This is advisory. Absence of a constitution is not a blocker, and no Complexity Tracking entries are needed.

**Post-design re-check (after Phase 1)**: PASS, unchanged — still no constitution in force. The design added no new projects, services, or indirection layers: one app, one native module, three stores (SQLite, filesystem, Drive) each with a distinct and necessary role. Had the two candidate principles above been ratified, the design would satisfy both — the frame path is integer-only end to end with no float conversion anywhere (D2, contracts/native-player.md), and no code path discards authored work (D9 retry-forever queue, D11 field preservation). The one deliberate compromise, D9's set-level atomicity, is documented in the open rather than papered over.

## Project Structure

### Documentation (this feature)

```text
specs/001-drive-video-metadata/
├── plan.md              # This file
├── research.md          # Phase 0 output — technical decisions + spike protocol
├── data-model.md        # Phase 1 output — entities, SQLite schema, state transitions
├── quickstart.md        # Phase 1 output — how to run and validate
├── contracts/           # Phase 1 output
│   ├── canonical-json.md    # The source-of-truth sidecar schema (v1)
│   ├── resolve-csv.md       # CSV projection (spike-gated)
│   ├── otio.md              # OTIO projection (spike-gated)
│   ├── drive-api.md         # Which Drive v3 calls we depend on
│   └── native-player.md     # JS ↔ Swift frame-accurate player interface
├── checklists/
│   └── requirements.md  # Spec quality checklist (16/16)
└── tasks.md             # /speckit-tasks output — NOT created here
```

### Source Code (repository root)

```text
app/                             # expo-router screens
├── index.tsx                    # Connected folder list (+ to add)
├── folder/[folderId].tsx        # Video grid: thumbnail, metadata badge, filter/sort
└── video/[videoId].tsx          # Player + metadata editor + save checkmark

src/
├── domain/                      # Pure, dependency-free. The heart of correctness.
│   ├── canonical.ts             # Canonical model types + schema version
│   ├── rational.ts              # Exact rational frame rate; frame↔time; NO float rounding
│   ├── markers.ts               # Marker validation (in-bounds, dedupe rules)
│   └── projections/
│       ├── csv.ts               # canonical → Resolve CSV (deterministic)
│       └── otio.ts              # canonical → OTIO JSON (deterministic, pinned schema)
├── data/
│   ├── db/                      # SQLite: migrations, queries
│   │   ├── schema.ts
│   │   └── repositories.ts      # metadata, folders, pending saves
│   ├── drive/                   # Drive v3 REST client (fetch-based)
│   │   ├── client.ts            # auth header injection, error mapping
│   │   ├── files.ts             # list, download, upload, update, delete
│   │   └── sidecars.ts          # read/write/delete a video's sidecar set
│   ├── cache/                   # video originals on disk
│   │   └── videoCache.ts        # download w/ progress+cancel, clear per folder
│   └── sync/
│       ├── queue.ts             # pending save queue
│       └── syncEngine.ts        # reconnect-driven publish, retry, reporting
├── features/
│   ├── auth/                    # Google Sign-In, scope grant, token refresh
│   ├── folders/                 # add/switch/list folders
│   ├── library/                 # video list, filter, sort, badges
│   └── editor/                  # comments, keywords, marker CRUD, save flow
└── ui/                          # shared components

modules/frame-player/            # Expo native module (Swift/AVFoundation)
├── ios/
│   ├── FramePlayerModule.swift  # zero-tolerance seek, step, exact frame reporting
│   ├── FramePlayerView.swift    # AVPlayerLayer-backed view
│   └── MediaProbe.swift         # codec, resolution, exact rate, duration, timecode, VFR detect
├── src/index.ts                 # typed JS interface
└── expo-module.config.json

tests/
├── unit/                        # domain logic, rational math, marker validation
├── golden/                      # pinned .json/.csv/.otio fixtures (SC-010)
└── integration/                 # sync engine, offline queue, Drive client (mocked)

tools/
└── sidecar-gen/                 # Phase 0 spike generator; reused as golden-file source
```

**Structure Decision**: Single Expo app at the repository root, with the domain layer deliberately isolated from React Native and Drive so the correctness-critical code (rational frame math, marker validation, the three writers) is testable as pure functions with no simulator or network. The native module is a separate Expo module under `modules/` rather than inline in the app so its Swift can be unit-tested and its interface stays explicit. `tools/sidecar-gen/` is the Phase 0 spike generator, retained afterwards to produce golden fixtures — the spike's output becomes a permanent test asset rather than throwaway code.

## Complexity Tracking

> No constitution is in force, so there are no violations to justify. Table intentionally empty.
