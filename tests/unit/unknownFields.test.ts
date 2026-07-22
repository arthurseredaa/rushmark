/**
 * Constitution Principle II — "Fields the app does not recognize MUST be
 * preserved verbatim on read and written back unchanged on save."
 *
 * The scenario under test is a real one: a future Rushmark writes a sidecar with
 * fields this build has never heard of. This build opens it, the user edits a
 * comment, and saves. Nothing the newer build wrote may be lost — otherwise the
 * app has destroyed the user's work on their behalf.
 */

import { buildCanonical, parseCanonical, serializeCanonical } from '@/domain/canonical';
import { extractUnknownFields, mergeUnknownFields } from '@/domain/unknownFields';

import {
  SPIKE_APP_VERSION,
  SPIKE_FILENAME,

  SPIKE_PROBE,
  SPIKE_WRITTEN_AT,
} from '../golden/fixtures';

describe('extractUnknownFields', () => {
  it('finds nothing in a sidecar this build fully understands', () => {
    const canonical = buildCanonical({
      filename: SPIKE_FILENAME,
      probe: SPIKE_PROBE,
      comments: 'hello',
      keywords: ['a'],
      markers: [],
      appVersion: SPIKE_APP_VERSION,
      writtenAt: SPIKE_WRITTEN_AT,
    });
    expect(extractUnknownFields(JSON.parse(serializeCanonical(canonical)))).toEqual({});
  });

  it('captures a wholly unrecognized top-level section', () => {
    const raw = { schema_version: 2, ai_analysis: { shots: [1, 2, 3], model: 'v9' } };
    expect(extractUnknownFields(raw)).toEqual({
      ai_analysis: { shots: [1, 2, 3], model: 'v9' },
    });
  });

  it('captures unrecognized keys nested inside a section it does know', () => {
    const raw = {
      authored: { comments: 'known', rating: 5, mood: 'bright' },
      technical: { codec: 'hevc', color_space: 'rec2020' },
    };
    expect(extractUnknownFields(raw)).toEqual({
      authored: { rating: 5, mood: 'bright' },
      technical: { color_space: 'rec2020' },
    });
  });

  it('does not report recognized fields as unknown', () => {
    const raw = { authored: { comments: 'x', keywords: ['y'] } };
    expect(extractUnknownFields(raw)).toEqual({});
  });
});

describe('mergeUnknownFields', () => {
  it('restores preserved sections', () => {
    const canonical = { schema_version: 1, authored: { comments: 'new' } };
    const merged = mergeUnknownFields(canonical, { ai_analysis: { model: 'v9' } });
    expect(merged).toEqual({
      schema_version: 1,
      authored: { comments: 'new' },
      ai_analysis: { model: 'v9' },
    });
  });

  it('lets the app win for fields it understands — preservation never overrides an edit', () => {
    const canonical = { authored: { comments: 'the user just typed this' } };
    const merged = mergeUnknownFields(canonical, {
      authored: { comments: 'stale value from the file' },
    });
    expect(merged.authored.comments).toBe('the user just typed this');
  });

  it('merges nested unknowns without dropping known siblings', () => {
    const canonical = { authored: { comments: 'c', keywords: ['k'] } };
    const merged = mergeUnknownFields(canonical, { authored: { rating: 5 } });
    expect(merged).toEqual({ authored: { comments: 'c', keywords: ['k'], rating: 5 } });
  });
});

describe('round trip: an older build must not delete a newer build’s fields', () => {
  it('preserves unknown fields verbatim through read -> edit -> write', () => {
    // A sidecar from the future: schema 2, with sections we have never seen.
    const fromTheFuture = {
      schema_version: 2,
      identity: { filename: SPIKE_FILENAME, drive_file_id: null },
      technical: {
        codec: 'hevc',
        width: 3840,
        height: 2160,
        frame_rate: { num: 24000, den: 1001 },
        duration_frames: 247,
        rate_mode: 'constant',
        source_timecode_frames: 1631008,
        color_space: 'rec2020', // unknown
      },
      authored: {
        comments: 'original comment',
        keywords: ['spike'],
        rating: 4, // unknown
      },
      markers: [],
      provenance: { authored_by: 'manual', app_version: '9.0.0', written_at: SPIKE_WRITTEN_AT },
      ai_analysis: { shots: [0, 120], model: 'whisper-v9' }, // wholly unknown
    };

    const parsed = parseCanonical(fromTheFuture);

    // It reads, rather than refusing: schema version is diagnostic, not a gate.
    expect(parsed.comments).toBe('original comment');
    expect(parsed.keywords).toEqual(['spike']);
    expect(parsed.warnings.some((w) => w.field === 'schema_version')).toBe(true);

    expect(parsed.unknownFields).toEqual({
      technical: { color_space: 'rec2020' },
      authored: { rating: 4 },
      ai_analysis: { shots: [0, 120], model: 'whisper-v9' },
    });

    // The user edits the comment and saves.
    const rebuilt = buildCanonical({
      filename: SPIKE_FILENAME,
      probe: SPIKE_PROBE,
      comments: 'the user changed this',
      keywords: parsed.keywords,
      markers: parsed.markers,
      appVersion: SPIKE_APP_VERSION,
      writtenAt: SPIKE_WRITTEN_AT,
    });

    const merged = mergeUnknownFields(
      rebuilt as unknown as Record<string, unknown>,
      parsed.unknownFields,
    );

    // The edit landed...
    expect((merged.authored as Record<string, unknown>).comments).toBe(
      'the user changed this',
    );
    // ...and nothing the newer build wrote was lost.
    expect(merged.ai_analysis).toEqual({ shots: [0, 120], model: 'whisper-v9' });
    expect((merged.authored as Record<string, unknown>).rating).toBe(4);
    expect((merged.technical as Record<string, unknown>).color_space).toBe('rec2020');
  });

  it('survives a second round trip — preservation is not one-shot', () => {
    const withUnknowns = {
      schema_version: 1,
      authored: { comments: 'a', keywords: [] },
      markers: [],
      custom_block: { keep: 'me' },
    };

    const first = parseCanonical(withUnknowns);
    const rebuilt = mergeUnknownFields(
      buildCanonical({
        filename: SPIKE_FILENAME,
        probe: SPIKE_PROBE,
        comments: 'b',
        keywords: [],
        markers: [],
        appVersion: SPIKE_APP_VERSION,
        writtenAt: SPIKE_WRITTEN_AT,
      }) as unknown as Record<string, unknown>,
      first.unknownFields,
    );

    const second = parseCanonical(JSON.parse(JSON.stringify(rebuilt)));
    expect(second.unknownFields).toEqual({ custom_block: { keep: 'me' } });
  });
});

describe('parseCanonical is lenient (FR-023a)', () => {
  it('reads what it can from a partially malformed sidecar', () => {
    const parsed = parseCanonical({
      schema_version: 1,
      authored: { comments: 'fine', keywords: ['ok', 42, 'good'] },
      markers: [
        { id: 'a', frame: 10, color: 'RED', name: 'keep' },
        { id: 'b', frame: 'not a number', color: 'RED' },
        { id: 'c', frame: 20, color: 'CHARTREUSE' },
      ],
    });

    expect(parsed.comments).toBe('fine');
    expect(parsed.keywords).toEqual(['ok', 'good']);
    expect(parsed.markers).toHaveLength(1);
    expect(parsed.markers[0]?.name).toBe('keep');
    expect(parsed.warnings.length).toBeGreaterThanOrEqual(3);
  });

  it('skips a non-integer frame rather than rounding it [Principle I]', () => {
    const parsed = parseCanonical({
      markers: [{ id: 'a', frame: 12.7, color: 'RED' }],
    });
    expect(parsed.markers).toHaveLength(0);
    expect(
      parsed.warnings.some((w) => /skipped rather than approximated/.test(w.message)),
    ).toBe(true);
  });

  it('never throws on garbage', () => {
    expect(() => parseCanonical(null)).not.toThrow();
    expect(() => parseCanonical('a string')).not.toThrow();
    expect(() => parseCanonical([1, 2, 3])).not.toThrow();
    expect(parseCanonical(null).warnings).toHaveLength(1);
  });
});
