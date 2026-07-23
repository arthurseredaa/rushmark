---
description: "Implementation plan for Drive Video Metadata Producer"
---

# Implementation Plan: Drive Video Metadata Producer

**Branch**: `001-drive-video-metadata` | **Date**: 2026-07-16 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-drive-video-metadata/spec.md`

## Summary

An iOS-only React Native app that connects to Google Drive folders of video, plays cached originals with frame-accurate positioning, and lets a single user author whole-video metadata (comments, keywords) and frame-accurate markers. On an explicit per-video save it publishes three sidecars next to the video in Drive: a canonical `.json` (source of truth) plus deterministic `.csv` and `.otio` projections for DaVinci Resolve. Authoring works fully offline; confirmed saves queue locally and publish automatically on reconnect.

> **Phase 0 spike: ✅ PASSED (2026-07-17)** — verified against DaVinci Resolve on the user's real 23.976 DJI footage. Markers map 1:1 onto exact frames (including frame 0 and the last frame, range durations intact); OTIO's float `rate` carries `24000/1001` losslessly, retiring the plan's biggest risk. `contracts/otio.md` and `contracts/resolve-csv.md` are confirmed, not hypotheses. **Implementation is unblocked.** See research.md §S1-a…S1-d.

**Technical approach**: Expo (bare workflow with a development client, not Expo Go — a custom native module is required). Frame accuracy is delivered by a thin native AVFoundation module exposing zero-tolerance seeking and frame stepping, because no off-the-shelf React Native player exposes the primitives that FR-007, FR-008, and SC-001 require. Local state lives in SQLite (metadata + pending save queue, durable) with video originals in the app's Documents directory (not Caches, which iOS purges under pressure — FR-010 forbids that). Drive is reached over its v3 REST API with tokens from Google Sign-In. The `.otio` and `.csv` writers are pure functions over the canonical model, built and validated by the Phase 0 spike before any app code.

**Folder-picker refinement (2026-07-24)**: Keep the custom picker folder-only. Move the existing current-folder selection trigger from its footer to an **Add** action in the header for every non-root folder, preserving the `onPick({ id, name })` contract and all downstream Drive, SQLite, and routing behavior. Retain an equal-width spacer at `My Drive` so the title stays centered. Add a rendered component regression suite; no Drive, authorization, database, or navigation contract changes.

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

Checked against **Rushmark Constitution v1.0.0** (ratified 2026-07-17).

**Status**: PASS — all three principles satisfied, one bounded exception recorded.

| Principle | How this design satisfies it |
|---|---|
| **I. Exactness Over Convenience** (NON-NEGOTIABLE) | Rates are `Rational{num,den}` end to end, never floats (`src/domain/rational.ts`). The native bridge speaks **integer frames only** — D2 rejects every off-the-shelf RN player precisely because they convert `CMTime` to a JS float, destroying exactness before our code sees it. `seekToFrame` resolves to the frame actually landed on. `Probe.rateMode` gates marker authoring: `variable` or `unknown` → refuse and explain (FR-019/FR-019a). VFR detection reads real sample timings rather than trusting `nominalFrameRate`, which lies about VFR footage (D3). |
| **II. Never Lose Authored Work** | Pending saves live in SQLite, durable across restarts (D8); the state machine has **no `pending → discarded` edge** (data-model.md). Failures keep the save queued with its cause surfaced (FR-038). Unrecognized fields are parked in `unknownFields` and deep-merged back on write (D11, FR-023b). Cache clearing is a filesystem operation and **cannot reach the database** — FR-036 holds by construction, which is what the principle demands. |
| **III. The Canonical Record Is The Only Authority** | `.csv` and `.otio` are pure functions in `src/domain/projections/`, deterministic and golden-tested (SC-010). The canonical is written **last** so a stale projection is a consistent old state (D9). Editor quirks stay in the projection layer — proven by the spike: OTIO's media-timecode coordinate bug (F13) lived entirely in `otio.ts` and was fixed by changing one writer; the canonical model kept 0-based offsets and was never touched. Schema version is recorded but diagnostic, not a read gate (D11). |

**Additional constraints**: client-only ✅ (no backend; Drive REST direct). Single user ✅ (last-write-wins, stated as an accepted consequence). iOS only ✅. Format assumptions verified against the real tool ✅ — the Phase 0 spike ran against DaVinci Resolve on real footage and corrected three guesses (BOM, CSV headers, coordinate system).

**Complexity Tracking**: one entry — D9's set-level atomicity (see below).

**Post-design re-check (after Phase 1)**: PASS, unchanged. The design adds no new projects, services, or indirection: one app, one native module, three stores each with a distinct and necessary role. The Phase 0 spike has since validated Principles I and III against the real editor — markers map 1:1 on exact frames, and the one bug found was contained in the projection layer exactly as Principle III predicts.

**Folder-picker refinement re-check (2026-07-24)**: PASS. The change moves one existing selection affordance and adds component coverage. It does not touch frame representation, authored metadata, canonical/projection authority, persistence, Drive writes, platform scope, or service boundaries.

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
│   ├── resolve-csv.md       # CSV projection (✅ confirmed vs Resolve)
│   ├── otio.md              # OTIO projection (✅ confirmed vs Resolve)
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
├── component/                   # rendered React Native interaction regressions
├── golden/                      # pinned .json/.csv/.otio fixtures (SC-010)
└── integration/                 # sync engine, offline queue, Drive client (mocked)

tools/
└── sidecar-gen/                 # Phase 0 spike generator; reused as golden-file source
```

**Structure Decision**: Single Expo app at the repository root, with the domain layer deliberately isolated from React Native and Drive so the correctness-critical code (rational frame math, marker validation, the three writers) is testable as pure functions with no simulator or network. The native module is a separate Expo module under `modules/` rather than inline in the app so its Swift can be unit-tested and its interface stays explicit. `tools/sidecar-gen/` is the Phase 0 spike generator, retained afterwards to produce golden fixtures — the spike's output becomes a permanent test asset rather than throwaway code.

## Folder-picker Add refinement

**Requirement**: FR-001a and SC-019.

**Files**:

- Modify `src/features/folders/folderPicker.tsx`.
- Create `tests/component/folderPicker.test.tsx`.

**Interaction flow**:

1. The user navigates from `My Drive` into a normal folder through the existing breadcrumb stack.
2. The header replaces its right-side spacer with an accessible **Add** `Pressable` when `current.id !== 'root'`.
3. Selecting **Add** calls the existing `onPick({ id: current.id, name: current.name })` once and resets the picker.
4. `app/index.tsx` keeps ownership of access validation, persistence, modal closure, error alerts, and navigation.

**State behavior**:

- `My Drive` renders the existing equal-width spacer and no **Add** action.
- Loading, empty, populated, and listing-error states retain the same body behavior.
- Empty state copy remains `No subfolders here`.
- Non-root loading, empty, populated, and listing-error states keep **Add** available.
- Remove the footer Connect button, root hint, `Button` import, and footer-only styles.
- Preserve the modal-local `SafeAreaProvider`, breadcrumb behavior, and folder-only Drive query.

**Validation**:

- Component tests mock `listFolders` and `useDrive` and exercise root, child-folder navigation, empty, and error states.
- Assert **Add** visibility, exact `onPick` payload and call count, retained empty copy, and absence of the footer Connect action.
- Run `npx jest --selectProjects component tests/component/folderPicker.test.tsx --runInBand`, `npm run typecheck`, and `npm test -- --runInBand`.

## Complexity Tracking

> One bounded compromise, recorded in the open as the Development Workflow requires.

| Item | Why needed | Simpler alternative rejected because |
|---|---|---|
| **D9: set-level atomicity is convergent, not transactional.** A video's three sidecars can briefly disagree (projections updated, canonical not yet) if the app dies mid-publish. | Google Drive offers **no multi-file transaction**. Individual uploads *are* atomic, so FR-028's real requirement — no corrupt or unreadable sidecar — holds absolutely. The residual window is a *stale* projection, which is milder, lasts seconds, is single-user, and self-heals via the retry queue that already exists for offline. Mitigated by writing the canonical **last**, so a stale projection beside an old canonical is a consistent old state. | *Upload to temp names then rename all three*: Drive renames aren't atomic across files either — identical window, more calls, more failure modes. *Silently allow partial sets*: violates the spec's intent and Principle III's regenerability. **No available alternative closes the window**; claiming a guarantee the platform cannot provide would be worse than stating the limit. |

This is not a principle violation — no authored work is lost (Principle II: the save stays queued
and retries), and projections remain fully regenerable from the canonical (Principle III). It is a
platform limit that the Development Workflow requires be documented rather than described as a
guarantee.
