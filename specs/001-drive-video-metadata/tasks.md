---
description: "Task list for Drive Video Metadata Producer"
---

# Tasks: Drive Video Metadata Producer

**Input**: Design documents from `/specs/001-drive-video-metadata/`

**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/ ✅, quickstart.md ✅

**Phase 0 spike**: ✅ PASSED 2026-07-17. The writers in `tools/sidecar-gen/src/` are **verified against DaVinci Resolve on real 23.976 footage**. Porting them to TypeScript means *transcribing verified behaviour*, not redesigning it. Three findings are load-bearing and must survive the port: the OTIO media-timecode offset (F13), no UTF-8 BOM on the CSV (F7), and the `Start TC`/`End TC` columns (D13a).

**Tests**: The spec does not request tests generally, so most phases have none. **Constitution-mandated verification is not optional** (Rushmark v1.0.0, Development Workflow): frame-math round-trips at every supported rate (Principle I) and golden-file tests pinning projection determinism (Principle III). Those tasks are marked **[CONST]** and may not be dropped.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3, US4)
- **[CONST]**: Constitution-mandated — not optional
- `[X]` done · `[~]` blocked, see note on the task
- Include exact file paths in descriptions

---

## Implementation status (2026-07-17)

**64 of 71 done. 7 blocked, none by a decision — all by a missing tool.**

Verified by machine:

| | |
|---|---|
| `npx jest` | **130 passing** across 6 suites |
| `npx tsc --noEmit` | clean |
| `npx eslint .` | clean |

The golden suite reproduces all three spike-verified sidecars **byte-for-byte** from the TypeScript port, so F13's timecode offset, F7's absent BOM, and D13a's TC columns are now regression-locked rather than remembered.

**Blocked, needing Xcode** (not installed here — Command Line Tools only, no CocoaPods):

- **T008** — `expo prebuild` + dev-client device build
- **T024** [CONST] — Swift XCTest frame-math suite. Written, never run. The TypeScript equivalent (T017) passes at all eight rates, but the Swift side does its own arithmetic and is unverified
- **T070** — quickstart validation on device

The whole of `modules/frame-player/ios/*.swift` has never been through a compiler. Assume it needs fixing, not that it works.

**Blocked, needing DaVinci Resolve + real footage** (the constitution's "verify against the real tool" clause — these are exactly the questions the spike left open, and guessing at them is what cost hours last time):

- **T065** — does Resolve read `Marker.metadata.note`? Fallback (`noteInName`) is implemented and ready
- **T066** — do Cyan/Yellow/Pink/Purple import? Only Red/Green/Blue are spike-verified
- **T067** — do Cyrillic comments survive CSV import now the BOM is gone?

**Blocked, needing a native shim:**

- **T069** — excluding cached video from iCloud backup. `expo-file-system` exposes no API for `NSURLIsExcludedFromBackupKey` in either its legacy or modern surface. Documented in `src/data/cache/videoCache.ts`. Resource usage, not correctness: no authored work lives in the cache

**Also needed before first run:** Google OAuth client IDs in `.env` (see `.env.example`). Sign-in cannot work without them.

## Path Conventions

Single Expo app at repository root per plan.md: `app/` (expo-router screens), `src/` (domain + data + features), `modules/frame-player/` (Swift native module), `tests/`, `tools/sidecar-gen/` (spike generator, retained as golden-fixture source).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Get an Expo dev-client app building on device with a native module slot. Expo Go cannot run this app — the frame-player module is native.

- [X] T001 Initialize Expo app with TypeScript at repository root via `npx create-expo-app@latest . --template blank-typescript`, preserving the existing `specs/`, `spike/`, `tools/`, and `.specify/` directories
- [X] T002 Install runtime dependencies in `package.json`: `expo-dev-client`, `expo-router`, `expo-sqlite`, `expo-file-system`, `@react-native-google-signin/google-signin`, `@react-native-community/netinfo`
- [X] T003 [P] Configure TypeScript strict mode and path aliases (`@/domain/*`, `@/data/*`, `@/features/*`, `@/ui/*`) in `tsconfig.json`
- [X] T004 [P] Configure ESLint + Prettier in `eslint.config.js` and `.prettierrc`, with a rule banning `parseFloat`/`Number()` coercion inside `src/domain/` (Principle I: no float may touch the frame path)
- [X] T005 [P] Configure Jest with `jest-expo` preset and `@testing-library/react-native` in `jest.config.js`, with `tests/unit`, `tests/golden`, `tests/integration` roots
- [X] T006 Configure `app.json`: iOS bundle identifier, deployment target 16.0, `expo-router` plugin, `expo-dev-client` plugin, and the Google Sign-In plugin with `iosUrlScheme`
- [X] T007 [P] Create `.env.example` documenting `GOOGLE_IOS_CLIENT_ID` and `GOOGLE_WEB_CLIENT_ID`, and read them in `app.config.ts` (`.env` is already git-ignored)
- [~] T008 Scaffold the native module at `modules/frame-player/` via `npx create-expo-module@latest --local frame-player`, then `npx expo prebuild -p ios` and verify a dev-client build runs on a physical device — **BLOCKED: Xcode not installed** (only Command Line Tools; no CocoaPods). Module source is written; `prebuild` and the device build cannot run here

**Checkpoint**: `npx expo run:ios` launches a dev client on device with an empty screen and a linked (stub) native module. ⚠️ Not reached — requires Xcode.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The correctness core — exact frame math, the three verified writers, the durable store, the native player, and Drive access. Every user story sits on this.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Domain layer — pure, dependency-free (ports the passing spike)

- [X] T009 [P] Port `tools/sidecar-gen/src/rational.js` to `src/domain/rational.ts`: `Rational{num,den}` type, `reduce`, `parseRate`, `rateEquals` (cross-multiply — never float comparison), `toOtioRate`. Throw on non-integer or non-positive components per contracts/canonical-json.md
- [X] T010 [P] Port `tools/sidecar-gen/src/timecode.js` to `src/domain/timecode.ts`: `labelledFps`, `framesToTimecode` (non-drop `HH:MM:SS:FF`), `timecodeToFrames` (returns `null` when unparseable, never a guess)
- [X] T011 [P] Define the canonical model types in `src/domain/canonical.ts` per contracts/canonical-json.md: `SCHEMA_VERSION = 1`, `Marker`, `VideoMetadata`, `PALETTE` (RED/GREEN/BLUE/CYAN/YELLOW/PINK/PURPLE), and the `unknownFields` bag (FR-023b)
- [X] T012 Implement marker rules in `src/domain/markers.ts` per data-model.md: `orderMarkers` (sort by frame, then sortIndex, then id), `validateMarkers` (in-bounds against duration, non-negative duration, palette membership) — ported from `tools/sidecar-gen/src/canonical.js`
- [X] T013 Implement `src/domain/canonical.ts` builders `buildCanonical` and `serializeCanonical` (stable key order, `\n` line endings) so identical input yields byte-identical output (SC-010)
- [X] T014 [P] Port the CSV projection to `src/domain/projections/csv.ts`: headers `File Name,Comments,Keywords,Start TC,End TC`, **no BOM** (F7 — a BOM glues to the first header and breaks matching), End TC computed **exclusive** as start + duration (D13a — this is why the CSV imports with Resolve's default options)
- [X] T015 [P] Port the OTIO projection to `src/domain/projections/otio.ts`: pinned schemas (`Timeline.1`, `Stack.1`, `Track.1`, `Clip.1`, `ExternalReference.1`, `TimeRange.1`, `RationalTime.1`, `Marker.2`), relative `target_url`, and **all ranges offset by the media's source timecode** (`tcBase`) — F13, the spike's costliest bug. 0-based ranges make Resolve report "The clip was not found"
- [X] T016 Implement `src/domain/unknownFields.ts`: extract unrecognized keys on read and deep-merge them back on write (FR-023b, Principle II)
- [X] T017 [P] [CONST] Frame-math round-trip tests in `tests/unit/rational.test.ts` and `tests/unit/timecode.test.ts`: for every supported rate (`24000/1001`, `24/1`, `25/1`, `30000/1001`, `30/1`, `50/1`, `60000/1001`, `60/1`), assert `timecodeToFrames(framesToTimecode(n, rate), rate) === n` across frame 0, mid-clip, and last frame; assert `rateEquals` distinguishes `24000/1001` from `24/1`. **Principle I — mandatory**
- [X] T018 [P] [CONST] Golden-file tests in `tests/golden/projections.test.ts` pinning `.json`/`.csv`/`.otio` byte-for-byte against the verified spike output in `spike/media/`; assert the CSV has no BOM and the OTIO ranges start at the media timecode. **Principle III — mandatory**

### Native module — frame-exact playback (contracts/native-player.md)

> ⚠️ **Written but NOT COMPILED.** Xcode is not installed in the implementation environment (Command Line Tools only, no CocoaPods), so none of the Swift below has been through a compiler and T024's XCTest suite has never run. Treat this section as reviewed-by-eye only until a machine with Xcode builds it.

- [X] T019 Implement `modules/frame-player/ios/MediaProbe.swift`: codec, resolution, exact rate as an integer rational, duration in frames, source timecode. Select the video track by **largest area**, excluding `mjpeg` and attached-pic tracks — DJI files carry an MJPEG thumbnail track at 90000/1 fps alongside the real one (spike F-probe)
- [X] T020 Add VFR detection to `modules/frame-player/ios/MediaProbe.swift` using `AVAssetReader` sample timings; return `rateMode: 'constant' | 'variable' | 'unknown'`. Never trust `nominalFrameRate`, which reports a plausible lie for VFR footage (D3)
- [X] T021 Implement `modules/frame-player/ios/FramePlayerModule.swift`: `seekToFrame` using `seek(to:toleranceBefore:.zero,toleranceAfter:.zero)` and `stepByFrames` using `AVPlayerItem.step(byCount:)`. The bridge speaks **integer frames only** — never seconds, never floats. Every call resolves with the frame actually landed on (Principle I)
- [X] T022 [P] Implement `modules/frame-player/ios/FramePlayerView.swift`: an `AVPlayerLayer`-backed view with play/pause and current-frame events
- [X] T023 Define the typed JS interface in `modules/frame-player/src/index.ts` per contracts/native-player.md: `probe`, `seekToFrame`, `stepByFrames`, `play`, `pause`, `onFrameChanged`, with `Rational` and `Probe` types imported from `src/domain/rational.ts`
- [~] T024 [CONST] Swift frame-math tests in `modules/frame-player/ios/Tests/FramePlayerTests.swift`: `CMTime` ↔ frame round-trips at every supported rate, asserting frame 0 and the final frame land exactly. **Principle I — mandatory**

### Data layer

- [X] T025 [P] Implement the SQLite schema and migration runner in `src/data/db/schema.ts` per data-model.md: `folders`, `videos`, `metadata`, `markers`, `pending_saves`, `keywords` tables with a `user_version` migration ladder
- [X] T026 Implement `src/data/db/repositories.ts`: typed CRUD for folders, video metadata, markers, and pending saves — the only module allowed to touch SQL
- [X] T027 [P] Implement the Drive REST client in `src/data/drive/client.ts` per contracts/drive-api.md: access-token header injection, retry with backoff, and error mapping that classifies **offline as a distinct non-error condition** (it must queue, not fail — FR-038)
- [X] T028 Implement the six Drive operations in `src/data/drive/files.ts`: list folder children, get file metadata, download media, upload (multipart create), update content, delete
- [X] T029 Implement `src/data/drive/sidecars.ts`: read/write/delete a video's `.json`/`.csv`/`.otio` set, writing the **canonical last** so an interrupted publish leaves a consistent older state (D9, plan.md Complexity Tracking)
- [X] T030 [P] Implement `src/data/cache/videoCache.ts`: resumable download into `Documents/` (**not** `Caches/` — iOS purges it, FR-010 forbids that) with progress reporting, cancel, `.partial` staging, and clear-per-folder
- [X] T031 [P] Implement `src/features/auth/googleAuth.ts`: Google Sign-In configured with the `https://www.googleapis.com/auth/drive` scope, token acquisition, silent refresh, and sign-out
- [X] T032 [P] Implement `src/data/sync/connectivity.ts`: a NetInfo-backed reachability observable, the single source of online/offline truth for the app
- [X] T033 Set up the expo-router shell in `app/_layout.tsx` with the SQLite provider, auth provider, and connectivity provider

**Checkpoint**: Domain math is verified at every rate, both projections are pinned to the spike's verified bytes, the native module reports exact frames on device, and Drive is reachable. User stories can begin.

---

## Phase 3: User Story 1 — Author and save (Priority: P1) 🎯 MVP

**Goal**: Connect a Drive folder, open a video, play it frame-accurately, author comments/keywords/markers, and publish the three sidecars next to the video.

**Independent Test**: Add a folder, open a video, place a marker on a known frame, save, then confirm three sidecars appear in Drive and the `.otio` imports into Resolve with the marker on that exact frame.

- [X] T034 [P] [US1] Implement the folder picker in `src/features/folders/folderPicker.tsx`: sign in, browse Drive folders, select one (FR-001)
- [X] T035 [US1] Implement the connected-folder list screen in `app/index.tsx` with a **+** button opening the picker, persisting the selection via the folders repository (FR-002)
- [X] T036 [US1] Implement the video list screen in `app/folder/[folderId].tsx`: list the folder's videos with thumbnail and a badge showing whether sidecars already exist (FR-003)
- [X] T037 [US1] Implement open-and-cache in `src/features/library/openVideo.ts`: download the original with progress and cancel, prompting for confirmation on cellular (FR-006a, FR-006b)
- [X] T038 [US1] Implement the player screen in `app/video/[videoId].tsx` using the frame-player module: play/pause, scrub, and frame-step controls that report the landed frame (FR-007, FR-008)
- [X] T039 [US1] Gate marker authoring on probe results in `src/features/editor/rateGate.ts`: when `rateMode` is `variable` or `unknown`, disable marker placement and explain why, allowing whole-video metadata only (FR-019, FR-019a, Principle I)
- [X] T040 [P] [US1] Implement the comments and keywords editor in `src/features/editor/MetadataEditor.tsx` (FR-013, FR-014)
- [X] T041 [US1] Implement marker CRUD in `src/features/editor/MarkerList.tsx` and `src/features/editor/markerActions.ts`: add at the current frame, edit name/note/color, set an optional duration, delete (FR-015, FR-016, FR-017)
- [X] T042 [US1] Implement the save pipeline in `src/features/editor/saveVideo.ts`: build the canonical from editor state, render both projections, upload all three via `sidecars.ts`, and surface success or failure (FR-025, FR-026, FR-027, FR-028)
- [X] T043 [US1] Wire the checkmark save control and its dirty/saving/saved states into `app/video/[videoId].tsx` (FR-024)
- [X] T044 [US1] Implement clear-and-save in `src/features/editor/saveVideo.ts`: when a video's metadata is emptied and saved, delete all three sidecars from Drive (FR-029a)

**Checkpoint**: MVP. The whole loop works online — connect, author, publish, verify in Resolve.

---

## Phase 4: User Story 2 — Reopen and continue editing (Priority: P2)

**Goal**: Reopening a video loads its published metadata back into the editor, without discarding anything the app doesn't understand.

**Independent Test**: Save a video, hand-add an unrecognized field to its `.json` in Drive, reopen, edit a comment, save again — the unrecognized field is still there, byte-identical.

- [X] T045 [US2] Implement sidecar reading in `src/features/editor/loadVideo.ts`: fetch the `.json` on open, parse leniently, and hydrate the editor. The `.csv` and `.otio` are **never read back** (Principle III)
- [X] T046 [US2] Implement lenient parsing in `src/domain/canonical.ts` (`parseCanonical`): read every field understood, skip malformed ones, and return warnings rather than throwing. Schema version is diagnostic, not a read gate (FR-023a, D11)
- [X] T047 [US2] Surface a non-blocking warning banner in `app/video/[videoId].tsx` when a sidecar parses with warnings (FR-023a)
- [X] T048 [US2] Wire `unknownFields` through load → edit → save in `src/features/editor/loadVideo.ts` and `saveVideo.ts`, so unrecognized fields round-trip verbatim (FR-023b, Principle II)
- [X] T049 [US2] Mirror the loaded metadata into the local store via `src/data/db/repositories.ts` on open, so reopening works from cache (FR-033)
- [X] T050 [P] [US2] Integration test in `tests/integration/roundtrip.test.ts`: load a sidecar carrying unknown fields, edit, save, and assert the unknown fields survive byte-for-byte

**Checkpoint**: US1 and US2 both work. Metadata survives a full publish → reopen → republish cycle.

---

## Phase 5: User Story 3 — Author offline, publish on reconnect (Priority: P2)

**Goal**: Full authoring on a plane. Confirmed saves queue durably and publish automatically when the network returns, without asking again.

**Independent Test**: Enable airplane mode, edit a cached video, save (it queues), force-quit and relaunch (it's still queued), re-enable the network — the sidecars appear in Drive with no further prompting.

- [X] T051 [US3] Make the local metadata store the editor's read path in `src/features/editor/loadVideo.ts`: serve from SQLite when offline, refresh from the sidecar when online (FR-032, FR-033)
- [X] T052 [US3] Implement the pending save queue in `src/data/sync/queue.ts`: enqueue a full canonical snapshot on offline save, dedupe by video (latest wins), and persist in SQLite so it survives restarts (FR-034, D8)
- [X] T053 [US3] Enforce the state machine from data-model.md in `src/data/sync/queue.ts`: a pending save leaves the queue only via success or explicit user discard. **There is no `pending → discarded` edge** (Principle II)
- [X] T054 [US3] Implement the sync engine in `src/data/sync/syncEngine.ts`: subscribe to connectivity, drain the queue on reconnect with backoff, and re-queue with the failure cause recorded rather than dropping (FR-035, FR-037, FR-038)
- [X] T055 [US3] Route saves through the queue in `src/features/editor/saveVideo.ts`: online publishes immediately, offline queues — the same confirmation either way, never a second confirmation later (FR-034, Principle II)
- [X] T056 [P] [US3] Show pending state in the UI: a per-video badge in `app/folder/[folderId].tsx` and a pending count with failure causes in `app/index.tsx` (FR-039, FR-040)
- [X] T057 [P] [US3] Integration test in `tests/integration/offlineQueue.test.ts` with a mocked Drive client and forced connectivity: save offline → assert queued and durable → reconnect → assert published exactly once
- [X] T058 [P] [US3] Integration test in `tests/integration/syncFailure.test.ts`: a failing upload keeps the save queued with its cause recorded and retries on the next reconnect

**Checkpoint**: Authoring is fully offline-capable. Nothing authored can be lost.

---

## Phase 6: User Story 4 — Manage folders and local storage (Priority: P3)

**Goal**: Several connected folders, a filterable library, and reclaimable disk that can never take unpublished work with it.

**Independent Test**: Connect two folders, filter one by keyword, clear its cache with a pending save outstanding — the videos are gone from disk, the pending save is untouched and still publishes.

- [X] T059 [P] [US4] Implement folder switching and removal in `app/index.tsx` and `src/features/folders/folderActions.ts` (FR-004, FR-005)
- [X] T060 [P] [US4] Implement the keyword index in `src/data/db/repositories.ts`, maintained on every metadata save
- [X] T061 [US4] Implement filter and sort in `app/folder/[folderId].tsx`: filter by keyword, sort by name/date/metadata presence (FR-011, FR-012)
- [X] T062 [US4] Implement clear-cache-per-folder in `src/features/library/cacheActions.tsx` with an explicit confirmation, calling only `videoCache.clearFolder` (FR-030)
- [X] T063 [US4] [CONST] Test in `tests/integration/cacheIsolation.test.ts` that clearing the cache with pending saves outstanding leaves the queue and metadata intact. `videoCache.ts` must import nothing from `src/data/db/` — assert this structurally, so FR-036 holds **by construction** rather than by careful coding (Principle II)
- [X] T064 [P] [US4] Show per-folder cache size and a total in `app/index.tsx` (FR-031)

**Checkpoint**: All four user stories are independently functional.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [~] T065 [P] Resolve the spike's open question on marker notes: emit `Marker.metadata.note` and check whether Resolve reads it. If not, fall back to appending the note to the marker name in `src/domain/projections/otio.ts` (the spike's `--note-in-name` behaviour). Record the result in research.md
- [~] T066 [P] Verify the remaining palette colours (Cyan, Yellow, Pink, Purple) import into Resolve — only Red/Green/Blue were confirmed by the spike. Fix the mapping in `src/domain/projections/otio.ts` if any fail
- [~] T067 [P] Verify non-ASCII comments (Cyrillic) survive CSV import now that the BOM is gone — untested and previously masked by the BOM. If broken, solve it in `src/domain/projections/csv.ts` only, never in the canonical model (Principle III)
- [X] T068 [P] Implement error and empty states across `app/` screens: no folders, empty folder, download failure, sign-in expiry
- [~] T069 [P] Exclude `Documents/` cached video from iCloud backup in `src/data/cache/videoCache.ts` and confirm the files survive simulated storage pressure (FR-010)
- [~] T070 Run the full quickstart.md validation on device against real Drive footage, including a Resolve import of the app's own output
- [X] T071 [P] Update `spike/README.md` and `specs/001-drive-video-metadata/research.md` to close out the open items resolved by T065–T067

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies — start immediately
- **Foundational (Phase 2)**: depends on Setup — **blocks every user story**
- **US1 (Phase 3)**: depends on Foundational. No dependency on other stories
- **US2 (Phase 4)**: depends on Foundational. Testable alone, but only meaningful once US1 can publish something to reopen
- **US3 (Phase 5)**: depends on Foundational. Reuses US1's save pipeline (T042) — build US1 first if working sequentially
- **US4 (Phase 6)**: depends on Foundational. Independent of US1–US3
- **Polish (Phase 7)**: depends on the desired stories being complete

### Within Phase 2

- T009–T011 are parallel; T012 needs T011; T013 needs T012; T014/T015 need T011 and T010
- T017 needs T009 and T010; T018 needs T013, T014, T015
- T019 → T020 → T021 → T022/T023 → T024
- T025 → T026; T027 → T028 → T029; T030, T031, T032 are parallel
- T033 needs T026, T031, T032

### Parallel Opportunities

- Setup: T003, T004, T005, T007 together
- Foundational: three independent tracks — **domain** (T009–T018), **native** (T019–T024), **data** (T025–T032) — can be built by three people at once with no file overlap
- Both [CONST] test tasks (T017, T018) run in parallel once their targets exist
- US1: T034 and T040 together; US2: T050 alone; US3: T056, T057, T058 together; US4: T059, T060, T064 together
- Polish: T065, T066, T067, T068, T069, T071 all touch different files

---

## Parallel Example: Phase 2 Foundational

```bash
# Three independent tracks, no shared files:
Track A (domain):  T009 rational.ts → T010 timecode.ts → T011 canonical.ts types
Track B (native):  T019 MediaProbe.swift → T020 VFR detection → T021 FramePlayerModule.swift
Track C (data):    T025 schema.ts → T026 repositories.ts, alongside T027 client.ts → T028 files.ts

# Then the mandated verification, in parallel:
Task: "T017 Frame-math round-trip tests at every supported rate in tests/unit/"
Task: "T018 Golden-file tests against spike/media/ in tests/golden/"
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1: Setup — dev client on device
2. Phase 2: Foundational — **the real work.** The domain layer is the product's correctness; the spike already proved the shape of it
3. Phase 3: US1 — connect, author, publish
4. **STOP and VALIDATE**: save a video from the app, import its `.otio` into Resolve, confirm markers land on the exact frames the app showed. This is the same check the spike passed — now with app-generated output
5. Usable at this point: it does the job online

### Incremental Delivery

1. Setup + Foundational → foundation ready
2. + US1 → publish from the app (**MVP**)
3. + US2 → reopen and continue; sidecars become durable working state, not one-shot exports
4. + US3 → author on a plane; the app's core promise
5. + US4 → several folders, filtering, reclaimable disk

### Note on phase sizing

Phase 2 is 25 of 71 tasks. That is honest rather than a smell: this app's product *is* exact frame math and three verified file formats. The screens are thin over that core, which is why US1 is only 11 tasks. Do not compress Phase 2 to make the burndown look better.

---

## Notes

- **The spike's three traps are encoded in T014, T015, and T019.** If a refactor ever "simplifies" the `tcBase` offset, drops the TC columns, or adds a BOM, T018 fails — that's what it's for
- [P] tasks = different files, no dependencies
- [CONST] tasks are mandated by the constitution and are not subject to the "tests are optional" default
- Commit after each task or logical group
- Stop at any checkpoint to validate a story independently
