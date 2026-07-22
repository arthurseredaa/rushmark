/**
 * Marker rules: ordering and validation.
 *
 * Ported from tools/sidecar-gen/src/canonical.js (Phase 0 spike, verified).
 * markers.ts imports only TYPES from canonical.ts, so there is no runtime cycle.
 */

import { PALETTE, type Marker, type Probe } from './canonical';

/**
 * Total, stable order so identical content yields identical bytes (SC-010).
 * Frame first, then the author's tie-break, then id — id is the last resort that
 * makes the order total rather than merely mostly-defined.
 */
export const orderMarkers = (markers: readonly Marker[]): Marker[] =>
  [...markers].sort(
    (a, b) =>
      a.frame - b.frame ||
      (a.sortIndex ?? 0) - (b.sortIndex ?? 0) ||
      String(a.id).localeCompare(String(b.id)),
  );

/**
 * Throws rather than repairing. Principle I: when a frame position cannot be
 * guaranteed, refuse the operation and explain — never guess, round, or drop.
 */
export function validateMarkers(
  markers: readonly Marker[],
  probe: Probe,
): readonly Marker[] {
  if (probe.rateMode !== 'constant') {
    if (markers.length) {
      // The whole point of FR-019/FR-019a: refuse rather than approximate.
      throw new Error(
        `refusing to write markers for rateMode="${probe.rateMode}" — ` +
          `frame positions cannot be guaranteed`,
      );
    }
    return [];
  }

  for (const m of markers) {
    if (!Number.isInteger(m.frame)) {
      throw new Error(`marker frame must be an integer: ${m.frame}`);
    }
    if (m.frame < 0 || m.frame >= probe.durationFrames) {
      throw new Error(
        `marker frame ${m.frame} out of bounds [0, ${probe.durationFrames - 1}]`,
      );
    }
    const dur = m.durationFrames ?? 0;
    if (!Number.isInteger(dur) || dur < 0) {
      throw new Error(`bad duration: ${dur}`);
    }
    if (m.frame + dur > probe.durationFrames) {
      throw new Error(
        `marker ${m.frame}+${dur} extends past end (${probe.durationFrames})`,
      );
    }
    if (!(PALETTE as readonly string[]).includes(m.color)) {
      throw new Error(`color "${m.color}" not in palette: ${PALETTE.join(', ')}`);
    }
  }
  return markers;
}
