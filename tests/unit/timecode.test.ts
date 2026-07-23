/**
 * [CONST] Constitution Principle I — mandated verification (task T017).
 *
 * "frame math round-trips at every supported rate" (Development Workflow).
 *
 * The round-trip is the property that matters: a frame turned into timecode and
 * back must be the same frame, at frame 0, mid-clip, and — the one that actually
 * catches off-by-ones — the final frame.
 */

import { SUPPORTED_RATES, formatRate, type Rational } from '@/domain/rational';
import {
  framesToClock,
  framesToTimecode,
  labelledFps,
  timecodeToFrames,
} from '@/domain/timecode';

describe('framesToClock', () => {
  it('reports elapsed wall-clock, not labelled frames', () => {
    // The distinction that matters: at 24000/1001 one second of timecode is
    // 24 frames, but 24 frames is 1001/1000 s of real time. At 1000 seconds of
    // timecode the clock is a full second behind — silently reusing timecode
    // here would drift visibly on a long clip.
    const ndf = { num: 24000, den: 1001 };
    expect(framesToClock(0, ndf)).toBe('0:00');
    expect(framesToClock(24, ndf)).toBe('0:01');
    expect(framesToClock(24000, ndf)).toBe('16:41'); // 1001 s, not 1000
    expect(framesToTimecode(24000, ndf)).toBe('00:16:40:00');
  });

  it('grows an hours field only when there is one', () => {
    const rate = { num: 25, den: 1 };
    expect(framesToClock(25 * 59, rate)).toBe('0:59');
    expect(framesToClock(25 * 60, rate)).toBe('1:00');
    expect(framesToClock(25 * 3600, rate)).toBe('1:00:00');
    expect(framesToClock(25 * 3661, rate)).toBe('1:01:01');
  });

  it('refuses anything that is not a non-negative integer frame', () => {
    const rate = { num: 30, den: 1 };
    expect(() => framesToClock(-1, rate)).toThrow();
    expect(() => framesToClock(1.5, rate)).toThrow();
  });
});

describe('labelledFps', () => {
  it('maps fractional rates to their label count', () => {
    expect(labelledFps({ num: 24000, den: 1001 })).toBe(24); // 23.976 -> 24 labels
    expect(labelledFps({ num: 30000, den: 1001 })).toBe(30);
    expect(labelledFps({ num: 60000, den: 1001 })).toBe(60);
  });

  it('is identity for integer rates', () => {
    expect(labelledFps({ num: 25, den: 1 })).toBe(25);
    expect(labelledFps({ num: 50, den: 1 })).toBe(50);
  });
});

describe('framesToTimecode', () => {
  it('reproduces the frames the spike verified in Resolve at 23.976', () => {
    // Spike F11: markers at 0/123/246 landed on these exact timecodes, 1:1.
    const rate: Rational = { num: 24000, den: 1001 };
    expect(framesToTimecode(0, rate)).toBe('00:00:00:00');
    expect(framesToTimecode(123, rate)).toBe('00:00:05:03');
    expect(framesToTimecode(246, rate)).toBe('00:00:10:06');
  });

  it('reproduces the media timecode the spike read off the DJI file', () => {
    // The file starts at 18:52:38:16 == frame 1631008, and Resolve reported
    // End TC 18:52:48:23 for start + 247 frames. This is the arithmetic that
    // the "clip was not found" bug turned on (F13).
    const rate: Rational = { num: 24000, den: 1001 };
    expect(framesToTimecode(1631008, rate)).toBe('18:52:38:16');
    expect(framesToTimecode(1631008 + 247, rate)).toBe('18:52:48:23');
  });

  it('refuses negative or non-integer frames', () => {
    const rate: Rational = { num: 24, den: 1 };
    expect(() => framesToTimecode(-1, rate)).toThrow(/non-negative integer/);
    expect(() => framesToTimecode(1.5, rate)).toThrow(/non-negative integer/);
  });
});

describe('timecodeToFrames', () => {
  it('returns null rather than guessing at unparseable input', () => {
    const rate: Rational = { num: 24, den: 1 };
    expect(timecodeToFrames('not a timecode', rate)).toBeNull();
    expect(timecodeToFrames('00:00:05', rate)).toBeNull();
    expect(timecodeToFrames('', rate)).toBeNull();
  });

  it('returns null when the frame field exceeds the label count', () => {
    // "00:00:00:99" at 24 fps is not a timecode. Returning 99 would be a guess.
    expect(timecodeToFrames('00:00:00:99', { num: 24, den: 1 })).toBeNull();
    expect(timecodeToFrames('00:00:00:24', { num: 24000, den: 1001 })).toBeNull();
  });
});

describe('round-trip at every supported rate [CONST]', () => {
  // A 90-minute clip is well past any realistic take, and 5399 seconds * 60fps
  // exercises the hour/minute carries that a short clip never reaches.
  const NINETY_MINUTES_SECONDS = 90 * 60;

  for (const rate of SUPPORTED_RATES) {
    describe(formatRate(rate), () => {
      const fps = labelledFps(rate);
      const lastFrame = NINETY_MINUTES_SECONDS * fps - 1;

      it('round-trips frame 0 — the first frame, which the spike verified', () => {
        expect(timecodeToFrames(framesToTimecode(0, rate), rate)).toBe(0);
      });

      it('round-trips the final frame — where off-by-ones actually live', () => {
        expect(timecodeToFrames(framesToTimecode(lastFrame, rate), rate)).toBe(lastFrame);
      });

      it('round-trips every frame across the first two seconds', () => {
        // Exhaustive across the second boundary: the carry from :FF to :SS is
        // exactly where a labelled-vs-wall-clock confusion would show up.
        for (let f = 0; f <= fps * 2; f += 1) {
          expect(timecodeToFrames(framesToTimecode(f, rate), rate)).toBe(f);
        }
      });

      it('round-trips across minute and hour boundaries', () => {
        const boundaries = [
          fps - 1,
          fps,
          fps * 60 - 1,
          fps * 60,
          fps * 3600 - 1,
          fps * 3600,
          fps * 3600 + 1,
        ];
        for (const f of boundaries) {
          expect(timecodeToFrames(framesToTimecode(f, rate), rate)).toBe(f);
        }
      });

      it('round-trips a spread of arbitrary frames', () => {
        for (let f = 0; f <= lastFrame; f += 997) {
          // 997 is prime — it walks the whole range without landing on a
          // convenient multiple of the frame rate every time.
          expect(timecodeToFrames(framesToTimecode(f, rate), rate)).toBe(f);
        }
      });

      it('is strictly monotonic — no two frames share a timecode', () => {
        const seen = new Set<string>();
        for (let f = 0; f < fps * 3; f += 1) {
          const tc = framesToTimecode(f, rate);
          expect(seen.has(tc)).toBe(false);
          seen.add(tc);
        }
      });
    });
  }
});
