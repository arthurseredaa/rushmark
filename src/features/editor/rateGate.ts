/**
 * Whether this footage may carry markers.
 *
 * Constitution Principle I: "When an exact rate cannot be determined, or footage
 * is variable-rate, the app MUST refuse the operation and explain why. It MUST
 * NOT guess, round, or approximate."
 *
 * FR-019a degrades rather than blocks: whole-video comments and keywords still
 * work on VFR footage. Only markers — the thing that needs an exact frame — are
 * withheld.
 */

import type { Probe } from '@/domain/canonical';
import { formatRate, isSupportedRate } from '@/domain/rational';

export type MarkerGate =
  | { allowed: true }
  | { allowed: false; reason: string; detail: string };

export function markerGate(probe: Probe | null): MarkerGate {
  if (!probe) {
    return {
      allowed: false,
      reason: 'Still reading this video',
      detail: 'Marker placement unlocks once the frame rate is confirmed.',
    };
  }

  switch (probe.rateMode) {
    case 'variable':
      return {
        allowed: false,
        reason: 'This video has a variable frame rate',
        detail:
          'Frame positions in variable-rate footage cannot be guaranteed to land where you put ' +
          'them, so Rushmark will not place markers rather than place them approximately. ' +
          'Comments and keywords still work.',
      };

    case 'unknown':
      return {
        allowed: false,
        reason: "This video's frame rate could not be confirmed",
        detail:
          'Rushmark could not read enough of this file to be certain of its frame rate, and it ' +
          'will not guess. Comments and keywords still work.',
      };

    case 'constant':
      if (!isSupportedRate(probe.frameRate)) {
        return {
          allowed: false,
          reason: `Unsupported frame rate (${formatRate(probe.frameRate)})`,
          detail:
            'Markers are only placed at frame rates Rushmark can map exactly into an editor. ' +
            'Comments and keywords still work.',
        };
      }
      return { allowed: true };

    default:
      return {
        allowed: false,
        reason: 'Unrecognized rate mode',
        detail: 'Rushmark will not place markers it cannot stand behind.',
      };
  }
}
