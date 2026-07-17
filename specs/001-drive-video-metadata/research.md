# Phase 0: Research & Technical Decisions

**Feature**: Drive Video Metadata Producer | **Date**: 2026-07-16

All Technical Context unknowns are resolved below. One item — the Resolve round-trip — is resolved as a *protocol to run*, not an answer, because it cannot be settled from documentation. It is the gating risk and is specified in full at the end.

---

## D1. React Native flavor: Expo with a development client

**Decision**: Expo SDK 54+, bare/dev-client workflow. Not Expo Go, not vanilla React Native CLI.

**Rationale**: The app needs a custom Swift module (D2), which rules out Expo Go immediately. That leaves dev-client Expo vs. plain RN CLI. Expo wins because every other dependency here has first-class Expo support with config plugins — `expo-sqlite`, `expo-file-system`, and `@react-native-google-signin/google-signin` (whose docs show an Expo config plugin taking `iosUrlScheme`, avoiding manual `Info.plist` surgery). The Expo Modules API also gives the native module a typed JS interface and a view component for free, which is exactly what the player needs. Nothing about "no backend, iOS only, one user" argues for the extra manual native config of the CLI path.

**Alternatives considered**:
- *Expo Go*: impossible — no custom native code.
- *React Native CLI*: viable, but hand-wiring CocoaPods, URL schemes, and a bridging layer for the player buys nothing here.
- *Native Swift app*: honestly the best fit for a frame-accurate iOS video tool. Rejected only because the spec fixes React Native as a constraint. Worth noting that the single riskiest piece (D2) is precisely the part where RN adds cost.

---

## D2. Frame-accurate playback: a custom AVFoundation module (no off-the-shelf player)

**Decision**: Write `modules/frame-player`, a thin Expo native module wrapping `AVPlayer`/`AVPlayerItem`, exposing zero-tolerance seek, frame stepping, and exact frame reporting. Do not use `expo-video`, `react-native-video`, or similar.

**Rationale**: This confirms the spec's flagged risk rather than dodging it. The requirements need three AVFoundation primitives that no React Native player surfaces:

1. **Zero-tolerance seek.** `AVPlayer.seek(to:)` defaults to non-zero tolerance and lands on the nearest *keyframe*, which can be seconds away. Only `seek(to:toleranceBefore: .zero, toleranceAfter: .zero)` lands on the requested frame. RN players either don't expose tolerance or accept seconds as a float — both fatal to SC-001/SC-005.
2. **Frame stepping.** `AVPlayerItem.step(byCount:)` steps exactly one frame. RN players expose only `seek(seconds)`, so "next frame" becomes `currentTime + 1/fps` — a float round-trip that drifts and cannot satisfy FR-007.
3. **Exact time as a rational.** `CMTime` is already `value/timescale` — an exact rational. Every RN player converts it to a JS float on the bridge, destroying the exactness FR-016 requires *before* our code ever sees it.

The JS side must therefore speak in **integer frames**, never seconds. Frames convert to `CMTime` in Swift using the track's exact rate, and positions come back as integer frames. Floats never touch a frame position.

**Alternatives considered**:
- *`expo-video` / `react-native-video`*: rejected on all three counts above. Fine for playback, unusable for frame-exact authoring.
- *Float seconds across the bridge with rounding in JS*: this is exactly the silent approximation NFR-1 forbids. `29.97 fps` is `30000/1001`; frame 1000 is not `33.3667s`, and repeated float conversion drifts.

---

## D3. Exact frame rate and VFR detection: `CMTime` from the track, honestly reported

**Decision**: Read the video track's `minFrameDuration` as a `CMTime` and carry `value`/`timescale` straight through as the rational rate. Detect variable frame rate by sampling actual frame timings with `AVAssetReader` and comparing them against that nominal duration. Never compute a rate as a float.

**Rationale**: `CMTime` gives exactness for free — a 23.976 clip reports `1001/24000`, and storing the pair keeps FR-016 satisfiable end to end. Detection matters because `nominalFrameRate` *lies about VFR footage*: an iPhone clip that ranges 22–30 fps still reports a tidy nominal 30. Trusting it would let the app write markers that land wrong in Resolve — the exact failure FR-019a exists to prevent. So detection reads real sample timings rather than the summary field.

**VFR rule**: read the first N frame durations (N ≈ 300, roughly 5–10s — bounded so opening a clip stays fast); if any differs from `minFrameDuration` beyond a tolerance of one timescale tick, classify the file as variable-rate and disable marker authoring per FR-019a. Rate genuinely undeterminable (no video track, zero duration) → FR-019 refusal.

**Alternatives considered**:
- *Trust `nominalFrameRate`*: rejected — silently wrong on the most common VFR sources.
- *Scan every frame*: exhaustive but makes opening a long clip slow, for a case the user rarely hits (they shoot constant 24/60). Bounded sampling catches real VFR, which varies early and often.
- *Float rate (29.97)*: rejected — `29.97 ≠ 30000/1001`, and the error compounds per frame.

---

## D4. Source timecode: best-effort from the timecode track

**Decision**: Look for an `AVMediaType.timecode` track and read its start frame via `AVAssetReader`. If absent, record explicit absence in the canonical model. Never substitute `00:00:00:00`.

**Rationale**: FR-012 requires exactly this, and the spec already flags it as best-effort. MP4/MOV from arbitrary sources often carries no timecode track at all. The distinction between "starts at zero" and "we don't know" is meaningful to an editor, so the model represents absence as `null`, not `0`.

---

## D5. Auth: `@react-native-google-signin/google-signin` with the full Drive scope

**Decision**: Sign in with `@react-native-google-signin/google-signin`, requesting `https://www.googleapis.com/auth/drive`. Take the access token via `getTokens()` and use it as a bearer token against the Drive v3 REST API. Configure through the Expo config plugin with `iosUrlScheme`.

**Rationale**: The library's docs confirm the scope-request and Expo-plugin paths directly. The broad `drive` scope is what the spec requires (FR-003) — the app must read videos it didn't upload and write beside them, which `drive.file` (app-created files only) cannot do. This is the choice that would trigger Google verification if published; the spec accepts that as a personal-use tradeoff. Tokens are refreshed via the library and never persisted by hand.

**Alternatives considered**:
- *`drive.file` scope*: no verification burden, but structurally cannot see pre-existing footage. Defeats the product.
- *`drive.readonly`*: cannot write sidecars.
- *Raw OAuth via `expo-auth-session`*: more moving parts, no benefit over a maintained library with a config plugin.

---

## D6. Drive access: v3 REST over `fetch`, not the `googleapis` SDK

**Decision**: Call Drive v3 REST endpoints directly with `fetch` and a bearer token. Six operations total; see [contracts/drive-api.md](./contracts/drive-api.md).

**Rationale**: The `googleapis` SDK is Node-oriented and heavy for a mobile bundle, and we need a handful of endpoints — list, get metadata, download media, create, update, delete. Docs confirm the shapes: `files.list` with a parent query, `alt=media` for download, multipart upload for create. Thumbnails come from `thumbnailLink` on the file metadata (FR-004), avoiding downloading video just to render a grid.

**Alternatives considered**:
- *`googleapis`*: rejected — bundle weight and Node assumptions for six calls.
- *Generating thumbnails locally from cached video*: needless work, and impossible before download.

---

## D7. Video cache in `Documents/`, not `Caches/` — an offline-driven decision

**Decision**: Store downloaded originals under `Documents/video-cache/<folderId>/`, with `isExcludedFromBackup` set. Use `expo-file-system`'s resumable download for progress and cancellation.

**Rationale**: This is where FR-010 becomes a hard constraint on implementation. iOS **purges `Caches/` under storage pressure without asking** — which would delete the clip a user is relying on mid-flight, with no way to re-download. FR-010 forbids exactly that, so the "obvious" cache directory is disqualified. `Documents/` persists until the app deletes it, matching "kept until the user clears them" (FR-009). The backup exclusion matters because these are gigabytes of *reconstructible* data — backing them up to iCloud would be hostile without adding safety, since the originals already live in Drive.

Resumable download gives FR-006b (progress + cancel) directly; a partial file is written to a `.partial` path and only moved into place on completion, so a partial is never mistaken for a cached copy.

**Alternatives considered**:
- *`Caches/`*: the conventional choice, and wrong here — the OS can purge it. Directly violates FR-010.
- *`tmp/`*: worse, purged more aggressively.
- *Including cache in iCloud backup*: gigabytes of redundant backup traffic.

---

## D8. Local store: SQLite for metadata and the pending queue

**Decision**: `expo-sqlite` holds folders, canonical metadata per video, markers, unrecognized-field blobs, and pending saves. Video bytes stay on the filesystem (D7). Schema in [data-model.md](./data-model.md).

**Rationale**: Offline authoring (FR-032/FR-033) means the local copy is what the user edits against — Drive is a publish target, not the read path. That store must be durable (FR-035, survives restarts), queryable (FR-005 keyword filter/sort across a folder without hitting network), and transactional (a save mutates metadata + markers + queue atomically). SQLite is the only option here that gives all three. Critically, keeping it **separate from the video cache** is what makes FR-036 true by construction: clearing cached videos deletes files on disk and cannot touch unpublished work in the database.

**Alternatives considered**:
- *JSON files on disk*: no transactions, no queries; keyword filtering means reading every file.
- *AsyncStorage/MMKV*: key-value, not relational; filtering and joins get hand-rolled.
- *Store metadata only in Drive*: impossible — offline has no Drive.

---

## D9. Sync: NetInfo-triggered queue drain, per-video all-or-nothing

**Decision**: A sync engine drains the pending queue on app foreground and on NetInfo reporting connectivity. Each pending save publishes its three sidecars; a save is only dequeued when all three succeed. Failures keep it queued with the cause recorded (FR-038). Publishing runs on any connection without prompting (FR-040).

**Rationale on atomicity — the honest version.** FR-028 forbids partial sidecars, and Drive offers **no multi-file transaction**. What Drive does give: each individual file upload is atomic (a new revision appears complete or not at all), so a *single truncated file* is impossible. The real exposure is set-level: `.json` updates, then the app dies before `.otio` does, leaving a stale `.otio` beside a fresh `.json`.

The mitigation is convergence rather than true atomicity: the queue keeps retrying until all three files land, and the canonical `.json` is written **last**. Ordering matters — since `.json` is the source of truth on read (FR-022) and projections are never read back (they exist only for Resolve), a stale projection next to an old `.json` is a consistent old state, while `.json`-first would advertise a new state the projections don't yet reflect. The window is seconds, single-user, and self-healing.

**This is a deliberate, bounded weakening of FR-028** — worth stating plainly rather than claiming a guarantee the platform can't provide. FR-028's real requirement (no *corrupt/unreadable* sidecar) holds absolutely; a briefly stale projection is a different, milder failure that converges on its own.

**Alternatives considered**:
- *Upload to temp names, then rename all three*: Drive renames aren't atomic across files either — same window, more calls, more failure modes.
- *Give up and allow partial sets silently*: violates the spec's intent; the retry queue costs nothing extra since it already exists for offline.
- *Background upload via `URLSession`*: real benefit (publishing after the app is backgrounded), but adds meaningful complexity. SC-017 only asks for "seconds after reconnect" while running. Defer; revisit if it bites.

---

## D10. Marker colors: the intersection of OTIO and Resolve

**Decision**: Fixed palette — **Red, Green, Blue, Cyan, Yellow, Pink, Purple**. No free color entry.

**Rationale**: Colors must survive canonical → OTIO → Resolve. OTIO's `Marker.color` is an enum (`RED`, `GREEN`, `BLUE`, `CYAN`, `MAGENTA`, `YELLOW`, `PINK`, `PURPLE`, `ORANGE`, `WHITE`, `BLACK`); Resolve's marker colors are its own named set (Blue, Cyan, Green, Yellow, Red, Pink, Purple, Fuchsia, Rose, Lavender, Sky, Mint, Lemon, Sand, Cocoa, Cream). Only names present in both round-trip predictably, so the palette is the intersection. Offering a color picker would let users choose colors that silently degrade on import — a small instance of the same "don't promise what you can't honor" rule as NFR-1.

**Spike-gated**: exact color-name mapping is confirmed by S1 below.

---

## D11. Canonical schema: version 1, lenient reader, field preservation

**Decision**: `schema_version: 1` recorded in every canonical file, treated as **diagnostic, not a gate** (FR-023a). The reader parses known fields, retains unknown ones verbatim in a SQLite blob, and merges them back on write (FR-023b). Schema in [contracts/canonical-json.md](./contracts/canonical-json.md).

**Rationale**: This follows the clarification directly — sidecars are only ever written by this app, so strict version gating defends against nothing while risking stranded work. Field preservation is what makes leniency safe: without it, an older build reading a newer file and saving would silently delete fields it didn't know about. The round-trip is verified by SC-013 as a golden test.

---

## D12. OTIO: hand-emitted JSON against a pinned schema

**Decision**: Emit OTIO JSON directly from a pure function. No OTIO library (none exists for React Native; the reference implementation is Python/C++). Pin schema versions: `Timeline.1`, `Stack.1`, `Track.1`, `Clip.1`, `ExternalReference.1`, `TimeRange.1`, `RationalTime.1`, `Marker.2`.

**Rationale**: OTIO's serialization is plain JSON with `OTIO_SCHEMA` string tags — writing it is mechanical, and the spec already anticipates this ("no native OTIO library is required"). `RationalTime` maps *perfectly* onto our model: it is `{value, rate}`, which is precisely the integer-frame-plus-exact-rate pair FR-016 mandates. This is the whole reason OTIO is the right marker carrier — no conversion, no rounding, marker frame N becomes `RationalTime(value: N, rate: exact)`.

`Marker.2` is pinned because it carries `name`, `color`, `marked_range`, and `metadata` (for the note). Point markers get a zero-duration `marked_range`; range markers get their frame duration.

**Spike-gated**: schema tag versions and whether Resolve reads the note from `metadata` are confirmed by S1.

---

## D13. Resolve CSV: filename-matched, two columns

**Decision**: A minimal CSV — a `File Name` column for matching plus `Comments` and `Keywords`. Deterministic ordering; markers deliberately absent (FR-031).

**Rationale**: Resolve's metadata import matches media-pool clips by filename, which aligns with the filename-identity clarification. The CSV carries no markers by design — that is the known, accepted loss, and OTIO covers it.

**Spike-gated and genuinely uncertain**: Resolve's CSV header labels are version-dependent, and the spec flags them as unverified. S1 confirms exact spellings by **exporting** metadata from the target Resolve build and reading the headers back — deriving them from the real thing rather than guessing.

---

## S1-a. Spike findings so far (from real footage, before Resolve)

Two findings from probing a real DJI Osmo Pocket 3 clip (`DJI_20260301165929_0131_D.MP4`, HEVC 4K):

**F1 — The user's "24 fps" is actually 23.976 (`24000/1001`).** The camera labels it 24; the file says `24000/1001`. This **contradicts the spec assumption** that the primary path is constant 24/60, and moves the fractional NTSC rate from "edge case we test defensively" to **the main path**. Consequences: D3's exact-rational handling is load-bearing rather than precautionary; SC-001's fractional-rate cases are the *primary* cases; and the OTIO float-rate question (D12) is now unavoidable — it applies to the user's everyday footage, not a rare import. Spec assumption updated accordingly.

**F2 — Real cameras embed a second video stream, and naive probing reads the wrong one.** The DJI file carries an MJPEG cover-art/thumbnail stream reporting **90000/1 fps** alongside the real HEVC track. "First video stream" is therefore *wrong*: had the thumbnail sorted first, the probe would have reported 90000 fps and poisoned every frame position downstream. The generator now filters `attached_pic` dispositions and MJPEG thumbnail tracks and selects the largest-area video track.

**Carried into `MediaProbe.swift`**: `AVAsset.tracks(withMediaType: .video)` has the same hazard — it can return cover art alongside footage. The native probe must select the primary track (largest `naturalSize`, non-cover), never `tracks.first`. Add a test fixture with an embedded thumbnail; DJI footage is a ready-made one.

**F3 — Timecode present and parsed.** `18:52:38:16` → frame 1631008. Confirms the timecode path works on real footage (FR-012); time-of-day timecode is the DJI default.

**F4 — Probe agrees with Resolve exactly.** Resolve independently reported 23.976 fps, Frames 247, End Frame 246, Start TC `18:52:38:16` — matching our probe on every value. Resolve's End TC `18:52:48:23` confirms the timecode counting convention our parser assumed (non-drop, 24 labelled frames/sec): 16 + 247 = 263 = 10s + 23f. The probe path is validated against the target editor.

## S1-b. CSV round-trip: ✅ CONFIRMED (SC-002 met)

Verified in Resolve on the DJI clip. **`contracts/resolve-csv.md` is no longer a hypothesis.**

**F5 — Header spellings confirmed**: `File Name`, `Comments`, `Keywords` — exactly as hypothesised. Comments imported verbatim. Match by filename *including* extension works ("Ignore file extensions" left unchecked).

**F6 — Keyword separator confirmed**: comma-space (`", "`) is parsed into **separate keyword chips**, not one string. This was a real open question (D13); the joined form is correct.

**F7 — The BOM broke the import.** With a UTF-8 BOM the import failed with "No matching media pool entries were found"; without it, it matched. The BOM's three bytes attach to the first header, so Resolve reads `<BOM>File Name` and cannot identify the match column. **Decision: never write a BOM.** `contracts/resolve-csv.md` updated.

⚠️ *Two variables changed between the failing and passing runs* (BOM removed **and** the timecode-match option unticked), so strictly the BOM is the prime suspect rather than the proven sole cause. Cheap to isolate later; not worth blocking on.

⚠️ **Open risk — non-ASCII**: the BOM was there to protect non-ASCII text. With it gone, comments in Cyrillic/accented characters may mangle on import. **Must test**: a comment containing non-Latin text. If it mangles, we need encoding correctness *and* header matching, which the BOM prevents — a real conflict needing a different answer.

**F8 — "Match using clip start and end Timecode" is ON by default and breaks the import.** Our CSV has no timecode columns, so Resolve finds no TC match and reports "No matching media pool entries". The user had to untick it manually.

**Decision D13a**: emit `Start TC` and `End TC` columns whenever `source_timecode_frames` is present, so the import works with Resolve's **default** options. Relying on the user to untick a box on every import is a trap that produces a confusing, misattributed failure. Where timecode is absent (null), the columns are omitted and unticking remains necessary — document it in-app.

**F9 — Keyword order is not preserved.** We wrote `resolve-check, spike, test` (sorted); Resolve displayed `spike, resolve-check, test`. Keywords are a set to Resolve. Harmless — our canonical still sorts them for determinism (SC-010) — but do not assert order round-trips.

**F10 — The metadata fields are only reachable on the Media page**, under the *Shot & Scene* view. The Edit page's Metadata panel shows *Clip Details* only, with no view selector — Comments/Keywords are simply unreachable there. Worth stating in any user-facing import instructions; it looks exactly like a failed import.

---

## S1-c. OTIO round-trip: ✅ CONFIRMED (SC-001 met)

Verified in Resolve on the DJI 23.976 clip. **The plan's highest risk is retired.**

**F11 — Markers map 1:1, exactly.** Frames 0 / 123 / 246 landed on `00:00:00:00` / `00:00:05:03` / `00:00:10:06` — exact, including **frame 0 and the last frame**. The 24-frame range marker imported as `00:00:01:00`, duration intact (FR-017).

**F12 — OTIO's float `rate` does NOT lose precision.** This was flagged as *"the single highest-risk line in the plan"* (D12). Resolve read `23.976023976023978`, showed 23.976 in the Load OTIO dialog (greyed — derived from our file), and reconstructed frame positions exactly. **`RationalTime{value: integer frame, rate: float}` is a safe carrier for `24000/1001`.** No fallback needed.

**F13 — CRITICAL: OTIO ranges are in MEDIA TIMECODE coordinates, not 0-based frame offsets.** This was the bug behind every "The clip was not found" failure. We declared `available_range` starting at frame 0; the file's timecode range is `[18:52:38:16 18:52:48:23)`. Resolve matches media by **timecode overlap** and rejected the clip outright:

```
Mismatch between specified target timecodes [00:00:00:00 00:00:10:07)
and located file timecodes [18:52:38:16 18:52:48:23)
No overlap between specified target timecodes ... and located file timecodes ...
```

**Fix**: `available_range.start_time`, `source_range.start_time`, and every `marked_range.start_time` must be offset by `source_timecode_frames` (1631008 here). Our canonical model keeps 0-based offsets — correct, that is the authority — and the OTIO *projection* adds the offset. Markers confirmed to share the clip's media-timecode coordinate space.

Where source timecode is absent (`null`), the base is 0 and the previous behaviour is right.

⚠️ **The error message actively misleads.** "The clip was not found" means "found it, but the timecodes don't overlap" — it points at file paths when the fault is the coordinate system. This cost several wrong hypotheses (URL form, filename case, relative paths). **The importer's Log window is where the truth is**; the modal is not.

**F14 — Resolve has a native OTIO importer** ("Load OTIO" dialog), not a generic XML path. It reads the frame rate from the file and greys out the field. Timeline resolution is *not* in OTIO (the format has no such concept) and is inherited from project settings — nothing to emit.

**F15 — Media linking still needs proof.** All successful imports so far used an **absolute `file://` URL**, which is unusable in production: the app writes sidecars on iOS, and the user later downloads the folder to an arbitrary path on a Mac. Since F13 shows the earlier bare-relative-name failure may have been the *timecode* mismatch all along — not the URL form — the relative form must be re-tested now that ranges are correct. **Open item; blocks nothing else.**

**F16 — Open: does OTIO carry comments/keywords?** The Metadata panel showed them after the OTIO import, but the CSV had populated that same Media Pool clip earlier in the session — so this is not evidence. Must be tested in a **fresh project importing only the `.otio`**. If OTIO carries them, `.csv` can be dropped from the design entirely (one fewer file, writer, and determinism surface). If not, the CSV stays and is already confirmed.

---

## S1-d. Default-settings import: ✅ CONFIRMED

**F17 — D13a works.** With `Start TC` and `End TC` columns emitted, the CSV imports under Resolve's **default** options — "Match using clip start and end Timecode" can stay ticked. Our computed values (`18:52:38:16` / `18:52:48:23`) match Resolve's own display exactly. The trap is gone: no setting to remember, no misleading error when forgotten. End TC is **exclusive** (start + duration), matching Resolve's convention.

**F18 — Clean-room test passed.** Media pool emptied, then OTIO-only import → video linked, timeline with markers, **Comments/Keywords empty**. Then CSV import → metadata populated on the clip. This proves both projections are necessary and non-overlapping, and that metadata attaches to the **clip** (which persists), not the timeline (a vehicle).

---

## S1. GATING SPIKE: the Resolve round-trip — ✅ PASSED (2026-07-17)

**Status**: **PASSED on real footage. Implementation is unblocked.** SC-001 and SC-002 are proven against Resolve, not assumed. Findings recorded in S1-a through S1-d; contracts `otio.md` and `resolve-csv.md` updated from hypothesis to confirmed.

**The two headline results**: markers map 1:1 onto exact frames on genuine 23.976 footage (including frame 0 and the last frame, with range durations intact), and OTIO's float `rate` field carries `24000/1001` without precision loss — retiring the plan's biggest risk.

**The bug worth remembering**: OTIO ranges are in media-timecode coordinates, not 0-based offsets (F13). Resolve's "clip not found" error blames paths for what is a timecode-overlap rejection.

**Still open, non-blocking**: marker notes (F: `metadata.note` unverified), palette colours beyond Red/Green/Blue, and non-ASCII/Cyrillic comments now the BOM is gone (F7).

*Original protocol retained below for reference.*

This is the spec's Phase 0 spike (§14) and the plan's highest risk. Two behaviors that SC-001 and SC-002 depend on are unverified, and both are cheap to test and expensive to discover late.

**Build**: `tools/sidecar-gen/` — a small standalone script generating `.json`, `.csv`, and `.otio` for one clip. This is the same pure logic that ships in `src/domain/projections/`, so the spike produces the real writers, not a throwaway.

**Protocol**:
1. Take one short clip at a known rate. Record filename, exact rational rate, frame count. Use a **24 or 60 fps** clip (what the user actually shoots), then repeat with 23.976 or 29.97 — fractional rates are where frame math breaks, and a spike passing only on 60 proves little.
2. Generate sidecars with 2–3 markers at known frames, deliberately including **frame 0** and the **last frame** (off-by-one and boundary errors hide there), plus one range marker.
3. In Resolve 18.6.5+: add the clip to the Media Pool; import the CSV metadata; import the `.otio`.
4. Verify: clip links to media; comments and keywords appear in the Metadata panel; markers appear at the **exact expected frames**, with correct names, notes, and colors.

**Confirm before writing app code**:
- Exact CSV header spellings — obtained by exporting from Resolve, not guessed (D13).
- Whether markers land 1:1, and whether any off-by-one exists at frame 0 or the last frame.
- Where Resolve reads a marker's note from (OTIO `metadata` vs `Marker.name`) (D12).
- Which of the D10 palette names survive.
- Whether OTIO source references resolve by relative path, absolute path, or need relinking.

**If it fails**: record exactly which layer broke (CSV headers / OTIO schema tags / marker mapping / colors) and adjust the writers. Findings feed FR-015, FR-016, FR-025, FR-030, FR-031, and may change the contracts in this directory.

**Output**: a validated generator (kept as the golden-fixture source for SC-010), confirmed field labels, and a confirmed target Resolve version.

---

## Resolved unknowns summary

| Unknown | Resolution |
|---|---|
| RN flavor | Expo dev-client (D1) |
| Frame-accurate stepping | Custom AVFoundation module — confirmed necessary (D2) |
| Exact rate + VFR detection | `CMTime` + bounded sample-timing scan (D3) |
| Source timecode | Best-effort timecode track; explicit null (D4) |
| Auth + scope | google-signin, full `drive` scope (D5) |
| Drive access | v3 REST over fetch (D6) |
| Cache location | `Documents/`, not `Caches/` — FR-010 (D7) |
| Local store | SQLite, separate from video cache (D8) |
| Sync + atomicity | NetInfo-driven queue; per-file atomic, set-level convergent (D9) |
| Marker colors | OTIO ∩ Resolve palette (D10) |
| Schema versioning | v1, diagnostic; lenient read + field preservation (D11) |
| OTIO emission | Hand-written JSON, pinned schemas (D12) |
| CSV format | Filename + Comments + Keywords (D13) |
| **Resolve round-trip** | **UNRESOLVED — spike S1 gates implementation** |
