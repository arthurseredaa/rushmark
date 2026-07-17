// Frame <-> timecode, non-drop.
//
// Timecode counts LABELLED frames per second: a 23.976 (24000/1001) clip uses
// 24 labels per second, so timecode is not wall-clock time. Verified against
// Resolve: file at 18:52:38:16 + 247 frames -> End TC 18:52:48:23.

/** Labelled frames per second for a rate: 24000/1001 -> 24, 30000/1001 -> 30. */
export const labelledFps = ({ num, den }) => Math.round(num / den);

/** Integer frames -> "HH:MM:SS:FF" (non-drop). */
export function framesToTimecode(frames, rate) {
  if (!Number.isInteger(frames) || frames < 0) {
    throw new Error(`frames must be a non-negative integer: ${frames}`);
  }
  const fps = labelledFps(rate);
  const f = frames % fps;
  const totalSeconds = Math.floor(frames / fps);
  const s = totalSeconds % 60;
  const m = Math.floor(totalSeconds / 60) % 60;
  const h = Math.floor(totalSeconds / 3600);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(h)}:${p(m)}:${p(s)}:${p(f)}`;
}

/** "HH:MM:SS:FF" -> integer frames (non-drop). Returns null if unparseable. */
export function timecodeToFrames(tc, rate) {
  const m = String(tc).match(/^(\d+):(\d+):(\d+):(\d+)$/);
  if (!m) return null;
  const [h, min, s, f] = m.slice(1).map(Number);
  return ((h * 60 + min) * 60 + s) * labelledFps(rate) + f;
}
