/**
 * The exact input that produced the sidecars in spike/media/ — the ones that
 * imported cleanly into DaVinci Resolve on 2026-07-17.
 *
 * Reconstructing the input here (rather than only diffing stored output) is what
 * makes the golden test meaningful: it proves the TypeScript port produces the
 * same bytes as the verified JavaScript generator, from the same facts.
 */

import type { Marker, Probe } from '@/domain/canonical';

export const SPIKE_FILENAME = 'DJI_20260301165929_0131_D.MP4';

/** Probed from the real DJI file. Note 24000/1001 — the camera labels this "24". */
export const SPIKE_PROBE: Probe = {
  codec: 'hevc',
  width: 3840,
  height: 2160,
  frameRate: { num: 24000, den: 1001 },
  durationFrames: 247,
  rateMode: 'constant',
  sourceTimecodeFrames: 1631008, // 18:52:38:16 — the frame F13 turned on
};

export const SPIKE_COMMENTS =
  'Spike test: verifying CSV metadata import and OTIO marker mapping.';

export const SPIKE_KEYWORDS = ['spike', 'test', 'resolve-check'];

/** First frame, mid-clip with a 24-frame range, and the last frame (246 of 247). */
export const SPIKE_MARKERS: Marker[] = [
  {
    id: 'm1',
    frame: 0,
    durationFrames: 0,
    name: 'Marker 1 @ frame 0',
    note: 'Cut in here',
    color: 'RED',
  },
  {
    id: 'm2',
    frame: 123,
    durationFrames: 24,
    name: 'Marker 2 @ frame 123',
    note: 'Best delivery of the line',
    color: 'GREEN',
  },
  {
    id: 'm3',
    frame: 246,
    durationFrames: 0,
    name: 'Marker 3 @ frame 246',
    note: 'Hold on this before the cut',
    color: 'BLUE',
  },
];

export const SPIKE_APP_VERSION = '0.0.0-spike';
export const SPIKE_WRITTEN_AT = '2026-07-17T00:00:00Z';
