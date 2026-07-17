# Quickstart & Validation

**Feature**: Drive Video Metadata Producer | **Date**: 2026-07-16

How to run the app and prove it works. Scenarios map to the spec's Success Criteria.

---

## Gate: spike ✅ PASSED (2026-07-17) — implementation unblocked

The Resolve round-trip is **verified on real 23.976 DJI footage**. SC-001 and SC-002 are proven, not assumed. See [research.md](./research.md) §S1-a…S1-d.

Regenerate sidecars for any clip at any time:

```bash
node tools/sidecar-gen/generate.js <video> --markers 0,middle,last
```

Useful flags for re-testing: `--url-form absolute|name|dot`, `--marker-base tc|zero`, `--csv-variant`, `--note-in-name`, `--bom`, `--dry-run`.

**Confirmed**: CSV headers `File Name,Comments,Keywords` (+ `Start TC`/`End TC` so the import works with Resolve's *default* options); markers 1:1 on exact frames incl. boundaries; OTIO float rate lossless for `24000/1001`; relative `target_url` links silently; CSV and OTIO both required.

**The one rule to remember**: OTIO ranges are in **media-timecode coordinates**, not 0-based offsets. Resolve rejects non-overlapping media with *"The clip was not found"* — which blames paths for a timecode fault. The importer's **Log window** carries the real reason.

**Still open (non-blocking)**: marker notes via `metadata.note`; palette colours beyond Red/Green/Blue; non-ASCII/Cyrillic comments now the BOM is removed.

---

## Prerequisites

- macOS with Xcode 15+ (a physical iOS 16+ device — frame-accurate video should be validated on real hardware)
- Node 20+
- A Google Cloud project with the Drive API enabled and an iOS OAuth client
- A Drive folder with a few videos, at least one shot at **24 or 60 fps** (constant rate)
- DaVinci Resolve 18.6.5+ for round-trip checks

## Setup

```bash
npm install
cp .env.example .env          # add GOOGLE_IOS_CLIENT_ID and iosUrlScheme
npx expo prebuild --platform ios
npx expo run:ios --device
```

Dev client, not Expo Go — the app has a custom native module (D1/D2).

## Test suites

```bash
npm test                  # unit: rational math, marker validation, sync logic
npm run test:golden       # SC-010: byte-identical .json/.csv/.otio
cd ios && xcodebuild test -scheme FramePlayerTests   # SC-001 frame math
```

The golden suite is the guard against silent projection drift and runs without a device or network.

---

## Scenario 1 — Author and save (P1, SC-002/SC-004)

1. Launch, tap **+**, sign in, grant Drive access, pick a folder.
2. Folder appears in the list; videos load with thumbnails and metadata badges.
3. Open a video → downloads with progress → plays.
4. Type comments, add keywords, place two markers with names/notes/colors.
5. Tap the checkmark.

**Expect**: `<filename>.mp4.json`, `.csv`, `.otio` appear in the Drive folder. Save completes in under 3 minutes excluding download (SC-004).

**Verify**: open the `.json` in Drive — `frame_rate` is a rational pair (`{"num":24000,"den":1001}`), **never a decimal**; marker `frame` values are integers.

## Scenario 2 — Frame accuracy (SC-001, SC-005) ⚠️ the critical one

1. Open a clip. Note the displayed frame number.
2. Step forward one frame → number increments by **exactly 1**, image advances one frame.
3. Step back → returns to the previous frame exactly.
4. Scrub to a frame, then away, then back → lands on the **same** frame.
5. Place markers at **frame 0**, a middle frame, and the **last frame**.
6. Save, download the `.otio`, import into Resolve.

**Expect**: markers at the exact frames. **Any deviation is a defect, not a tolerance** (SC-001).

**Repeat on 23.976 or 29.97 footage.** Fractional rates are where frame math breaks; passing only on 60 fps proves very little.

## Scenario 3 — Reopen (P2, SC-003)

1. Reopen a saved video → comments, keywords, markers restore exactly.
2. Edit a marker's note, save, reopen → edit persisted, frame unchanged.
3. Repeat 3× → **no drift** in any frame position.

## Scenario 4 — Offline authoring (P2, SC-015/SC-016/SC-017) ⚠️ the other critical one

1. Open 3 videos while connected (caches them + their metadata).
2. **Enable Airplane Mode.**
3. Open each cached video → plays frame-accurately, metadata available.
4. Author metadata on each; tap the checkmark → saved-but-pending, **no error**.
5. Verify frame stepping still works — offline must not degrade accuracy (SC-015).
6. **Force-quit and relaunch, still offline** → all pending saves and values intact (SC-016).
7. **Disable Airplane Mode.**

**Expect**: pending saves publish automatically within seconds, no prompt, pending count → 0 (SC-017). All three sidecars land per video.

**Also**: try opening an *uncached* video offline → clear "unavailable offline" message (FR-039).

## Scenario 5 — Cache vs. work (SC-018) — the separation that matters

1. Author and save a video **offline** (pending).
2. Still offline, clear that folder's cache.
3. **Expect**: cached video bytes gone; the **pending save survives**.
4. Reconnect → it publishes.

This proves FR-036's DB/filesystem separation. If this fails, the store boundary is wrong (D8).

## Scenario 6 — Clear and delete (SC-012)

1. Open a video with saved metadata; clear comments, keywords, all markers.
2. Save → **all three sidecars removed** from Drive; badge clears.
3. **Expect**: no empty sidecar left behind.

## Scenario 7 — Field preservation (SC-013) — the sneaky one

1. Hand-add an unknown key to a `.json` in Drive: `"future_field": {"x": 1}`.
2. Open the video → recognized fields load; small warning shown.
3. Edit a comment, save.
4. **Expect**: `future_field` is **still there, byte-identical**.

If this fails, a future app version silently deletes data an older one didn't understand — the exact failure FR-023b exists to prevent.

## Scenario 8 — Rate gates (SC-009, SC-014)

1. Open a **VFR** clip (an iPhone clip in low light, or a screen recording).
2. **Expect**: plays; comments/keywords work; **marker authoring disabled with an explanation** (FR-019a).
3. Save → `.json` has `"rate_mode": "variable"` and `"markers": []`.

**The app must never write an approximate marker.** If markers are placeable here, FR-019a is broken.

## Scenario 9 — Cellular (SC-011)

1. Wi-Fi off, cellular on. Open an uncached video.
2. **Expect**: prompt showing the **file size** before any download (FR-006a). Cancel → no download.
3. Confirm → downloads with progress; cancel mid-way → no partial treated as cached.
4. With a pending save, reconnect on cellular → **publishes without prompting** (FR-040 — sidecars are kilobytes).

## Scenario 10 — Cache survival (FR-010)

1. Cache several videos. Fill the device's storage close to full.
2. Use other apps; return.
3. **Expect**: cached videos **still present**. iOS must not have purged them.

This is why the cache lives in `Documents/`, not `Caches/` (D7). A failure here means offline work can evaporate mid-flight with no way to re-download.

---

## Definition of done

| Check | Criteria |
|---|---|
| S1 spike passed | SC-001, SC-002 |
| Golden tests pass | SC-010 |
| Frame math tests pass at all rates | SC-001, SC-005 |
| Scenarios 1–10 pass on device | full spec |
| No float in any frame path | NFR-1 |
| Offline cycle loses nothing | SC-016 |
