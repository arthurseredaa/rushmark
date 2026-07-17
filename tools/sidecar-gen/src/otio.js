// OTIO projection — carries the frame-accurate markers. See contracts/otio.md.
//
// SPIKE-GATED. The critical unknown: OTIO's `rate` is a FLOAT, not a rational
// pair. We emit the full double expansion (23.976023976023978, never 23.976).
// Whether Resolve recovers exact frames from it is what this spike proves.
//
// Hand-emitted JSON with pinned schema tags — no OTIO library (D12).

import { toOtioRate } from './rational.js';

export const SCHEMAS = {
  timeline: 'Timeline.1',
  stack: 'Stack.1',
  track: 'Track.1',
  clip: 'Clip.1',
  externalReference: 'ExternalReference.1',
  timeRange: 'TimeRange.1',
  rationalTime: 'RationalTime.1',
  marker: 'Marker.2',
};

const rationalTime = (value, rate) => ({
  OTIO_SCHEMA: SCHEMAS.rationalTime,
  value, // integer frame — 1:1, no conversion
  rate,
});

const timeRange = (start, duration, rate) => ({
  OTIO_SCHEMA: SCHEMAS.timeRange,
  start_time: rationalTime(start, rate),
  duration: rationalTime(duration, rate),
});

/**
 * How to express the media reference. OTIO's target_url is a URL field; a bare
 * filename may not be parseable by an importer. Spike tests which form Resolve
 * actually relinks from.
 */
export function buildTargetUrl(filename, { form = 'name', absoluteDir = null } = {}) {
  switch (form) {
    case 'name':
      return filename; // bare relative name
    case 'dot':
      return `./${filename}`; // explicit relative URL
    case 'absolute': {
      if (!absoluteDir) throw new Error('absolute form needs absoluteDir');
      // file:// URL with percent-encoded path segments
      const encoded = absoluteDir.split('/').map(encodeURIComponent).join('/');
      return `file://${encoded}/${encodeURIComponent(filename)}`;
    }
    case 'abspath':
      if (!absoluteDir) throw new Error('abspath form needs absoluteDir');
      return `${absoluteDir}/${filename}`; // plain absolute path, no scheme
    default:
      throw new Error(`unknown target_url form: ${form}`);
  }
}

export function buildOtio(
  canonical,
  { noteInName = false, urlForm = 'name', absoluteDir = null, markerBase = 'tc' } = {},
) {
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
  //   "No overlap between specified target timecodes [00:00:00:00 00:00:10:07)
  //    and located file timecodes [18:52:38:16 18:52:48:23)"
  // So a file starting at 18:52:38:16 must declare available_range starting at
  // that frame (1631008), NOT 0. Confirmed against Resolve 2026-07-17.
  const tcBase = t.source_timecode_frames ?? 0;
  const full = timeRange(tcBase, t.duration_frames, rate);

  // Our canonical marker frames are 0-based offsets from the first frame (the
  // authority). Project them into the same timecode coordinate.
  const markerOffset = markerBase === 'tc' ? tcBase : 0;

  const markers = canonical.markers.map((m) => ({
    OTIO_SCHEMA: SCHEMAS.marker,
    // Variant for the spike: if Resolve ignores metadata.note, try folding the
    // note into the visible name instead.
    name: noteInName && m.note ? `${m.name} — ${m.note}` : m.name,
    color: m.color,
    marked_range: timeRange(markerOffset + m.frame, m.duration_frames, rate),
    metadata: m.note ? { note: m.note } : {},
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

export const serializeOtio = (o) => JSON.stringify(o, null, 2) + '\n';
