# Contract: `modules/frame-player` — JS ↔ Swift

**Status**: Stable design; needs validation on device (D2).
**Why it exists**: no off-the-shelf React Native player exposes the AVFoundation primitives SC-001 and SC-005 require. This confirms the spec's flagged risk rather than working around it.

## The one rule

> **The bridge speaks integer frames. Never seconds. Never floats.**

Every frame position crossing JS ↔ Swift is an `Int`. Conversion to `CMTime` happens **only in Swift**, using the track's exact rate. A float seconds value anywhere in this interface is a bug — it's the silent approximation NFR-1 forbids, and it would defeat every other safeguard in the design.

`29.97 fps` is `30000/1001`. Frame 1000 is not `33.3667s`. Round-tripping through float seconds drifts, and drift is invisible until markers land wrong in Resolve.

## JS interface

```ts
type Rational = { num: number; den: number };

type Probe = {
  codec: string;
  width: number;
  height: number;
  frameRate: Rational | null;            // null → undeterminable (FR-019)
  durationFrames: number | null;
  sourceTimecodeFrames: number | null;   // null = ABSENT, never 0 (FR-012)
  rateMode: 'constant' | 'variable' | 'unknown';  // (FR-019a)
};

// Inspect a cached file without playing it.
function probe(fileUri: string): Promise<Probe>;

// View component
type FramePlayerProps = {
  source: string;                        // local file URI; never a remote URL
  onReady?: (p: Probe) => void;
  onFrameChanged?: (frame: number) => void;   // integer, authoritative
  onError?: (e: { code: string; message: string }) => void;
};

type FramePlayerRef = {
  play(): Promise<void>;
  pause(): Promise<void>;
  seekToFrame(frame: number): Promise<number>;  // resolves to the frame ACTUALLY landed on
  stepFrames(count: number): Promise<number>;   // ±1 typical; resolves to landed frame
  getCurrentFrame(): Promise<number>;
};
```

## Swift implementation requirements

**These three are the contract. Everything else is detail.**

1. **Zero-tolerance seek.**
   ```swift
   player.seek(to: time, toleranceBefore: .zero, toleranceAfter: .zero)
   ```
   Non-negotiable. Default `seek(to:)` lands on the nearest **keyframe** — potentially seconds off. This single parameter pair is the difference between meeting SC-005 and shipping a broken product.

2. **Frame stepping via AVFoundation, not arithmetic.**
   ```swift
   playerItem.step(byCount: count)
   ```
   Not `seek(currentTime + 1/fps)`. Let AVFoundation do it; it knows the real frame boundaries.

3. **Frame ↔ CMTime with the exact rate.**
   ```swift
   // frame → time. rate = num/den as CMTime components; NO Double.
   CMTime(value: CMTimeValue(frame) * CMTimeValue(rate.den),
          timescale: CMTimeScale(rate.num))
   // time → frame
   let frame = Int(round(time.seconds * Double(rate.num) / Double(rate.den)))
   ```
   `CMTime` is already exact rational arithmetic — use it rather than reimplementing it.

4. **`seekToFrame` resolves to the frame actually landed on**, read back from the player — not the frame requested. If they ever differ, the caller must be able to see it. A seek that silently reports success while landing elsewhere is exactly the failure SC-005 exists to catch.

## Probing (`MediaProbe.swift`)

| Field | Source |
|---|---|
| `codec` | `track.formatDescriptions` → `CMFormatDescriptionGetMediaSubType` |
| `width`/`height` | `track.naturalSize` × `preferredTransform` (rotation matters) |
| `frameRate` | `track.minFrameDuration` as `CMTime` → `{num: timescale, den: value}`, reduced |
| `durationFrames` | `asset.duration` converted with the exact rate |
| `sourceTimecodeFrames` | `AVMediaType.timecode` track via `AVAssetReader`; **`nil` if absent** (D4) |
| `rateMode` | sample-timing scan, below |

**Never use `track.nominalFrameRate`** for the stored rate — it's a `Float`, and it *lies about VFR footage* (an iPhone clip ranging 22–30 fps reports a tidy 30). `minFrameDuration` gives the exact `CMTime`.

### VFR detection (FR-019a, D3)

```
read up to ~300 frame durations via AVAssetReader
if any duration differs from minFrameDuration by > 1 timescale tick:
    rateMode = .variable
else:
    rateMode = .constant
```

Bounded so opening a clip stays fast. Real VFR varies early and often, so a few hundred frames catches it. Exhaustive scanning would slow every open for a case the user rarely hits (they shoot constant 24/60).

No video track, zero duration, or unreadable rate → `rateMode = .unknown`, `frameRate = nil` → FR-019 refusal.

## Playback

- `AVPlayerLayer`-backed view.
- Local files only. Frame-accurate work requires a downloaded copy (spec non-goal: no streaming preview).
- `onFrameChanged` via `addPeriodicTimeObserver`, emitting **integer frames**. This is what FR-008 renders, and SC-005 requires it to always match the frame displayed.

## Testing (XCTest)

Frame math is the highest-value unit test surface in the project, and it needs no simulator UI:
- frame → `CMTime` → frame round-trips exactly at 23.976, 24, 25, 29.97, 30, 60 (SC-001's matrix).
- Frame 0 and the last frame round-trip (boundary cases — same ones S1 checks in Resolve).
- Known-VFR fixture → `.variable`; known-CFR fixture → `.constant`.
- Timecode-less fixture → `nil`, **not** `0`.
