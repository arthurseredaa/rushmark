/**
 * [CONST] Constitution Principle III — mandated verification (task T018).
 *
 * "The .csv and .otio MUST be pure, deterministic projections of the canonical
 *  record. Identical canonical content MUST produce byte-identical projections."
 *
 * These fixtures are not arbitrary. They are the exact bytes that imported
 * cleanly into DaVinci Resolve on 2026-07-17, on real 23.976 footage. Three
 * findings cost real time to discover and are each pinned below:
 *
 *   F7  — a UTF-8 BOM breaks CSV matching
 *   F13 — OTIO ranges are in media-timecode coordinates, not 0-based offsets
 *   D13a— Start TC / End TC are why the CSV imports with DEFAULT options
 *
 * If a refactor "simplifies" any of them away, this suite is what notices.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildCanonical, parseCanonical, serializeCanonical } from '@/domain/canonical';
import { buildCsv } from '@/domain/projections/csv';
import { buildOtio, serializeOtio } from '@/domain/projections/otio';

import {
  SPIKE_APP_VERSION,
  SPIKE_COMMENTS,
  SPIKE_FILENAME,
  SPIKE_KEYWORDS,
  SPIKE_MARKERS,
  SPIKE_PROBE,
  SPIKE_WRITTEN_AT,
} from './fixtures';

const MEDIA_DIR = join(__dirname, '..', '..', 'spike', 'media');
const readFixture = (ext: string): string =>
  readFileSync(join(MEDIA_DIR, `${SPIKE_FILENAME}.${ext}`), 'utf8');

const canonical = buildCanonical({
  filename: SPIKE_FILENAME,
  driveFileId: null,
  probe: SPIKE_PROBE,
  comments: SPIKE_COMMENTS,
  keywords: SPIKE_KEYWORDS,
  markers: SPIKE_MARKERS,
  appVersion: SPIKE_APP_VERSION,
  writtenAt: SPIKE_WRITTEN_AT,
});

describe('canonical .json', () => {
  it('reproduces the spike fixture byte-for-byte', () => {
    expect(serializeCanonical(canonical)).toBe(readFixture('json'));
  });

  it('carries the frame rate as an exact rational, not a decimal', () => {
    expect(canonical.technical.frame_rate).toEqual({ num: 24000, den: 1001 });
    expect(serializeCanonical(canonical)).not.toMatch(/23\.976/);
  });

  it('keeps marker frames as 0-based offsets — the editor coordinate stays out', () => {
    // Principle III: the OTIO timecode base is a projection concern. If it ever
    // leaks into the canonical, this fails.
    expect(canonical.markers.map((m) => m.frame)).toEqual([0, 123, 246]);
  });

  it('is deterministic across repeated builds (SC-010)', () => {
    const again = buildCanonical({
      filename: SPIKE_FILENAME,
      driveFileId: null,
      probe: SPIKE_PROBE,
      comments: SPIKE_COMMENTS,
      keywords: SPIKE_KEYWORDS,
      markers: SPIKE_MARKERS,
      appVersion: SPIKE_APP_VERSION,
      writtenAt: SPIKE_WRITTEN_AT,
    });
    expect(serializeCanonical(again)).toBe(serializeCanonical(canonical));
  });

  it('sorts keywords so input order cannot change the bytes', () => {
    const shuffled = buildCanonical({
      filename: SPIKE_FILENAME,
      driveFileId: null,
      probe: SPIKE_PROBE,
      comments: SPIKE_COMMENTS,
      keywords: ['test', 'resolve-check', 'spike'], // different input order
      markers: SPIKE_MARKERS,
      appVersion: SPIKE_APP_VERSION,
      writtenAt: SPIKE_WRITTEN_AT,
    });
    expect(serializeCanonical(shuffled)).toBe(serializeCanonical(canonical));
  });
});

describe('.csv projection', () => {
  const csv = buildCsv(canonical);

  it('reproduces the spike fixture byte-for-byte', () => {
    expect(csv).toBe(readFixture('csv'));
  });

  it('has NO byte order mark [F7]', () => {
    // The BOM's bytes attach to the first header, so Resolve reads "<BOM>File
    // Name", cannot identify the match column, and blames the media pool.
    expect(csv.charCodeAt(0)).not.toBe(0xfeff);
    expect(csv.startsWith('File Name')).toBe(true);
    expect(Buffer.from(csv, 'utf8').subarray(0, 3)).not.toEqual(
      Buffer.from([0xef, 0xbb, 0xbf]),
    );
  });

  it('emits Start TC and End TC, which is why it imports with DEFAULT options [D13a]', () => {
    // Resolve ships with "Match using clip start and end Timecode" ticked.
    // Without these columns the import matches nothing.
    const [headerLine] = csv.split('\r\n');
    expect(headerLine).toBe('File Name,Comments,Keywords,Start TC,End TC');
  });

  it('computes End TC as exclusive (start + duration), matching Resolve', () => {
    const [, valueLine] = csv.split('\r\n');
    expect(valueLine).toContain('18:52:38:16');
    expect(valueLine).toContain('18:52:48:23');
  });

  it('separates keywords with comma-space so Resolve makes separate chips [F6]', () => {
    expect(csv).toContain('"resolve-check, spike, test"');
  });

  it('carries no markers — CSV cannot, which is why OTIO also exists [F18]', () => {
    expect(csv).not.toContain('Marker 1');
    expect(csv).not.toContain('Cut in here');
  });

  it('is deterministic', () => {
    expect(buildCsv(canonical)).toBe(csv);
  });
});

describe('.otio projection', () => {
  const otio = serializeOtio(buildOtio(canonical));

  it('reproduces the spike fixture byte-for-byte', () => {
    expect(otio).toBe(readFixture('otio'));
  });

  it('offsets every range by the media source timecode [F13]', () => {
    // The bug that reported itself as "The clip was not found". A file starting
    // at 18:52:38:16 must declare ranges from frame 1631008, not 0.
    const parsed = JSON.parse(otio);
    const clip = parsed.tracks.children[0].children[0];
    expect(clip.source_range.start_time.value).toBe(1631008);
    expect(clip.media_reference.available_range.start_time.value).toBe(1631008);
    expect(clip.source_range.duration.value).toBe(247);
  });

  it('places markers at tcBase + canonical frame [F13]', () => {
    const parsed = JSON.parse(otio);
    const markers = parsed.tracks.children[0].children[0].markers;
    expect(markers.map((m: { marked_range: { start_time: { value: number } } }) =>
      m.marked_range.start_time.value,
    )).toEqual([1631008 + 0, 1631008 + 123, 1631008 + 246]);
  });

  it('preserves the 24-frame range marker duration [F11]', () => {
    const parsed = JSON.parse(otio);
    const markers = parsed.tracks.children[0].children[0].markers;
    expect(markers[1].marked_range.duration.value).toBe(24);
  });

  it('carries the note in the native `comment` field, not metadata [item 3]', () => {
    // OTIO Marker.2 has a first-class `comment`; the generic `metadata` sub-dict
    // is app-namespaced and adapters do not read it as a note, which is why
    // marker notes never surfaced in Resolve. PENDING Resolve re-confirmation.
    const parsed = JSON.parse(otio);
    const markers = parsed.tracks.children[0].children[0].markers;
    expect(markers.map((m: { comment: string }) => m.comment)).toEqual([
      'Cut in here',
      'Best delivery of the line',
      'Hold on this before the cut',
    ]);
    expect(markers.every((m: { metadata: object }) => Object.keys(m.metadata).length === 0)).toBe(
      true,
    );
  });

  it('emits the full float expansion of 24000/1001, never 23.976 [F12]', () => {
    expect(otio).toContain('23.976023976023978');
    expect(otio).not.toMatch(/"rate": 23\.976\b/);
  });

  it('pins every OTIO schema version [NFR-4]', () => {
    for (const schema of [
      'Timeline.1',
      'Stack.1',
      'Track.1',
      'Clip.1',
      'ExternalReference.1',
      'TimeRange.1',
      'RationalTime.1',
      'Marker.2',
    ]) {
      expect(otio).toContain(`"${schema}"`);
    }
  });

  it('links media by bare relative filename, which links silently [F15]', () => {
    const parsed = JSON.parse(otio);
    const ref = parsed.tracks.children[0].children[0].media_reference;
    expect(ref.target_url).toBe(SPIKE_FILENAME);
  });

  it('hangs markers off the clip, not the track — that is what makes them 1:1', () => {
    const parsed = JSON.parse(otio);
    const track = parsed.tracks.children[0];
    expect(track.children[0].markers).toHaveLength(3);
    expect(track.markers).toBeUndefined();
  });

  it('is deterministic', () => {
    expect(serializeOtio(buildOtio(canonical))).toBe(otio);
  });

  it('markerBase="zero" reproduces the F13 bug — kept only to prove the fix', () => {
    const broken = JSON.parse(serializeOtio(buildOtio(canonical, { markerBase: 'zero' })));
    const markers = broken.tracks.children[0].children[0].markers;
    // 0-based markers against a timecode-based clip range: exactly the state
    // that made Resolve report "The clip was not found".
    expect(markers[0].marked_range.start_time.value).toBe(0);
  });
});

describe('schema v2 authored fields — Description, People, Good Take', () => {
  const v2 = buildCanonical({
    filename: SPIKE_FILENAME,
    driveFileId: null,
    probe: SPIKE_PROBE,
    comments: 'c',
    keywords: ['k'],
    description: 'A quiet establishing shot.',
    people: ['Bob', 'Alice'],
    goodTake: true,
    markers: [],
    appVersion: SPIKE_APP_VERSION,
    writtenAt: SPIKE_WRITTEN_AT,
  });

  it('stamps the canonical at schema_version 2', () => {
    expect(v2.schema_version).toBe(2);
  });

  it('sorts people for determinism, like keywords', () => {
    expect(v2.authored.people).toEqual(['Alice', 'Bob']);
  });

  it('adds a CSV column only for a populated field', () => {
    const csv = buildCsv(v2);
    const [header] = csv.split('\r\n');
    expect(header).toBe('File Name,Comments,Keywords,Description,People,Good Take,Start TC,End TC');
  });

  it('omits the v2 columns entirely when those fields are empty', () => {
    // Populated-only keeps the common case byte-identical to the v1 golden CSV.
    const [header] = buildCsv(canonical).split('\r\n');
    expect(header).toBe('File Name,Comments,Keywords,Start TC,End TC');
  });

  it('round-trips the v2 fields through the canonical read path', () => {
    const parsed = parseCanonical(JSON.parse(serializeCanonical(v2)));
    expect(parsed.description).toBe('A quiet establishing shot.');
    expect(parsed.people).toEqual(['Alice', 'Bob']);
    expect(parsed.goodTake).toBe(true);
    expect(parsed.unknownFields).toEqual({});
  });
});

describe('projections are regenerable from the canonical alone [Principle III]', () => {
  it('rebuilds both projections from parsed canonical bytes', () => {
    // The canonical is the only authority: round-tripping it through its own
    // serialized form must yield identical projections.
    const reparsed = JSON.parse(serializeCanonical(canonical));
    expect(buildCsv(reparsed)).toBe(readFixture('csv'));
    expect(serializeOtio(buildOtio(reparsed))).toBe(readFixture('otio'));
  });
});
