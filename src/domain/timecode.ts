/**
 * Frame <-> timecode, non-drop.
 *
 * Timecode counts LABELLED frames per second: a 23.976 (24000/1001) clip uses
 * 24 labels per second, so timecode is not wall-clock time. Verified against
 * Resolve: file at 18:52:38:16 + 247 frames -> End TC 18:52:48:23.
 *
 * Ported from tools/sidecar-gen/src/timecode.js (Phase 0 spike, verified).
 */

import type { Rational } from './rational';

/**
 * Labelled frames per second for a rate: 24000/1001 -> 24, 30000/1001 -> 30.
 *
 * This is the one audited place in the domain where a rate meets a rounding
 * operation, and it is legitimate: the result is a LABEL COUNT for timecode
 * arithmetic, never a frame position. Every frame position stays an exact
 * integer. The lint rule banning Math.round in src/domain exists to make any
 * other use of it a deliberate, visible decision rather than a slip.
 */
// eslint-disable-next-line no-restricted-properties
export const labelledFps = ({ num, den }: Rational): number => Math.round(num / den);

/** Integer frames -> "HH:MM:SS:FF" (non-drop). */
export function framesToTimecode(frames: number, rate: Rational): string {
  if (!Number.isInteger(frames) || frames < 0) {
    throw new Error(`frames must be a non-negative integer: ${frames}`);
  }
  const fps = labelledFps(rate);
  const f = frames % fps;
  const totalSeconds = Math.floor(frames / fps);
  const s = totalSeconds % 60;
  const m = Math.floor(totalSeconds / 60) % 60;
  const h = Math.floor(totalSeconds / 3600);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${p(h)}:${p(m)}:${p(s)}:${p(f)}`;
}

/**
 * "HH:MM:SS:FF" -> integer frames (non-drop). Returns null if unparseable.
 *
 * Null rather than a guess: Principle I requires refusing when a value cannot
 * be determined exactly. Callers must handle null, not coerce it.
 */
export function timecodeToFrames(tc: string, rate: Rational): number | null {
  const m = String(tc).match(/^(\d+):(\d+):(\d+):(\d+)$/);
  if (!m) return null;
  const [h, min, s, f] = m.slice(1).map(Number) as [number, number, number, number];
  const fps = labelledFps(rate);
  if (f >= fps) return null; // frame field cannot exceed the label count
  return ((h * 60 + min) * 60 + s) * fps + f;
}
