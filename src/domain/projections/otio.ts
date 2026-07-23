/**
 * OTIO projection — carries the frame-accurate markers. See contracts/otio.md.
 *
 * CONFIRMED against DaVinci Resolve 2026-07-17. Two findings are load-bearing:
 *
 *  F12 — OTIO's `rate` is a FLOAT, not a rational pair. Emitting the full double
 *        expansion (23.976023976023978, never 23.976) is LOSSLESS for 24000/1001:
 *        Resolve recovers exact frames. This was the plan's biggest risk.
 *  F13 — ranges live in MEDIA TIMECODE coordinates, not 0-based offsets. See
 *        the comment on tcBase below. This one cost an hour of chasing the wrong
 *        error message.
 *
 * Hand-emitted JSON with pinned schema tags — no OTIO library (D12).
 * Ported from tools/sidecar-gen/src/otio.js. tests/golden pins the bytes.
 */

import type { Canonical } from '../canonical';
import { toOtioRate } from '../rational';

export const SCHEMAS = {
  timeline: 'Timeline.1',
  stack: 'Stack.1',
  track: 'Track.1',
  clip: 'Clip.1',
  externalReference: 'ExternalReference.1',
  timeRange: 'TimeRange.1',
  rationalTime: 'RationalTime.1',
  marker: 'Marker.2',
} as const;

type RationalTime = { OTIO_SCHEMA: string; value: number; rate: number };
type TimeRange = { OTIO_SCHEMA: string; start_time: RationalTime; duration: RationalTime };

const rationalTime = (value: number, rate: number): RationalTime => ({
  OTIO_SCHEMA: SCHEMAS.rationalTime,
  value, // integer frame — 1:1, no conversion
  rate,
});

const timeRange = (start: number, duration: number, rate: number): TimeRange => ({
  OTIO_SCHEMA: SCHEMAS.timeRange,
  start_time: rationalTime(start, rate),
  duration: rationalTime(duration, rate),
});

export type UrlForm = 'name' | 'dot' | 'absolute' | 'abspath';

/**
 * How to express the media reference.
 *
 * Spike F15: a bare relative filename links SILENTLY in Resolve, provided the
 * .otio sits beside the video. The elaborate forms below are retained because
 * they were built while chasing what turned out to be a timecode fault, and they
 * cost nothing to keep — but 'name' is the verified default.
 */
export function buildTargetUrl(
  filename: string,
  { form = 'name', absoluteDir = null }: { form?: UrlForm; absoluteDir?: string | null } = {},
): string {
  switch (form) {
    case 'name':
      return filename; // bare relative name — verified
    case 'dot':
      return `./${filename}`; // explicit relative URL
    case 'absolute': {
      if (!absoluteDir) throw new Error('absolute form needs absoluteDir');
      const encoded = absoluteDir.split('/').map(encodeURIComponent).join('/');
      return `file://${encoded}/${encodeURIComponent(filename)}`;
    }
    case 'abspath':
      if (!absoluteDir) throw new Error('abspath form needs absoluteDir');
      return `${absoluteDir}/${filename}`; // plain absolute path, no scheme
    default:
      throw new Error(`unknown target_url form: ${String(form)}`);
  }
}

export type OtioOptions = {
  urlForm?: UrlForm;
  absoluteDir?: string | null;
  /** 'tc' is the verified default. 'zero' exists only to reproduce the F13 bug in tests. */
  markerBase?: 'tc' | 'zero';
};

export function buildOtio(canonical: Canonical, options: OtioOptions = {}): unknown {
  const { urlForm = 'name', absoluteDir = null, markerBase = 'tc' } = options;

  const t = canonical.technical;
  if (!t.frame_rate) throw new Error('cannot build OTIO without an exact frame rate');
  if (t.rate_mode !== 'constant' && canonical.markers.length) {
    throw new Error(`refusing to emit markers for rate_mode="${t.rate_mode}"`);
  }

  const rate = toOtioRate(t.frame_rate);
  const filename = canonical.identity.filename;

  // OTIO ranges live in MEDIA TIMECODE coordinates, not 0-based frame offsets.
  // Resolve matches media by timecode overlap and rejects a clip whose declared
  // range does not intersect the file's real timecodes:
  //   "Mismatch between specified target timecodes [00:00:00:00 00:00:10:07)
  //    and located file timecodes [18:52:38:16 18:52:48:23)"
  // ...reported to the user as "The clip was not found", which blames the file
  // path for a timecode fault. It had already located the file. The real reason
  // is only in the importer's Log window.
  //
  // So a file starting at 18:52:38:16 must declare available_range starting at
  // frame 1631008, NOT 0. Confirmed against Resolve 2026-07-17.
  const tcBase = t.source_timecode_frames ?? 0;
  const full = timeRange(tcBase, t.duration_frames, rate);

  // Our canonical marker frames are 0-based offsets from the first frame (the
  // authority — Principle III keeps this coordinate system out of the model).
  // Project them into the same timecode coordinate here, at the boundary.
  const markerOffset = markerBase === 'tc' ? tcBase : 0;

  const markers = canonical.markers.map((m) => ({
    OTIO_SCHEMA: SCHEMAS.marker,
    name: m.name,
    color: m.color,
    // The note goes in OTIO's first-class `comment` field (Marker.2), the
    // schema-blessed home for it. It previously lived in `metadata`, the generic
    // app-namespaced sub-dict adapters do not interpret — which is why marker
    // notes never surfaced in Resolve. PENDING re-confirmation on the next import.
    comment: m.note,
    marked_range: timeRange(markerOffset + m.frame, m.duration_frames, rate),
    metadata: {},
  }));

  return {
    OTIO_SCHEMA: SCHEMAS.timeline,
    name: filename,
    global_start_time: null,
    tracks: {
      OTIO_SCHEMA: SCHEMAS.stack,
      name: 'tracks',
      children: [
        {
          OTIO_SCHEMA: SCHEMAS.track,
          name: 'V1',
          kind: 'Video',
          children: [
            {
              OTIO_SCHEMA: SCHEMAS.clip,
              name: filename,
              source_range: full,
              media_reference: {
                OTIO_SCHEMA: SCHEMAS.externalReference,
                target_url: buildTargetUrl(filename, { form: urlForm, absoluteDir }),
                available_range: full,
              },
              // Markers hang off the CLIP, not the track — that is what makes
              // them map back to SOURCE frames 1:1 (SC-001).
              markers,
            },
          ],
        },
      ],
    },
    metadata: {},
  };
}

export const serializeOtio = (o: unknown): string => JSON.stringify(o, null, 2) + '\n';
