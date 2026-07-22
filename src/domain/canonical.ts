/**
 * The canonical model — the source of truth. See contracts/canonical-json.md.
 *
 * Constitution Principle III: this is the only authority. The .csv and .otio are
 * derived from it and are never read back. Editor quirks do not belong here.
 *
 * Ported from tools/sidecar-gen/src/canonical.js (Phase 0 spike, verified).
 */

import { orderMarkers, validateMarkers } from './markers';
import type { Rational } from './rational';
import { extractUnknownFields } from './unknownFields';

export const SCHEMA_VERSION = 1;

export const PALETTE = ['RED', 'GREEN', 'BLUE', 'CYAN', 'YELLOW', 'PINK', 'PURPLE'] as const;
export type MarkerColor = (typeof PALETTE)[number];

export const isMarkerColor = (v: unknown): v is MarkerColor =>
  typeof v === 'string' && (PALETTE as readonly string[]).includes(v);

/** How confident we are in the frame rate. Gates marker authoring (FR-019a). */
export type RateMode = 'constant' | 'variable' | 'unknown';

/** Facts read from the media file itself. Never user-edited. */
export type Probe = {
  readonly codec: string;
  readonly width: number;
  readonly height: number;
  readonly frameRate: Rational;
  readonly durationFrames: number;
  readonly rateMode: RateMode;
  /** null when the file carries no source timecode — best-effort per the spec. */
  readonly sourceTimecodeFrames: number | null;
};

/** A marker as authored in the app: 0-based frame offset from the first frame. */
export type Marker = {
  readonly id: string;
  readonly frame: number;
  readonly durationFrames?: number;
  readonly name?: string;
  readonly note?: string;
  readonly color: MarkerColor;
  /** Tie-break for markers on the same frame. Keeps ordering total (SC-010). */
  readonly sortIndex?: number;
};

/** A marker as serialized into the canonical sidecar. */
export type CanonicalMarker = {
  frame: number;
  duration_frames: number;
  name: string;
  note: string;
  color: MarkerColor;
};

export type Canonical = {
  schema_version: number;
  identity: {
    filename: string;
    drive_file_id: string | null;
  };
  technical: {
    codec: string;
    width: number;
    height: number;
    frame_rate: Rational;
    duration_frames: number;
    rate_mode: RateMode;
    source_timecode_frames: number | null;
  };
  authored: {
    comments: string;
    keywords: string[];
  };
  markers: CanonicalMarker[];
  provenance: {
    authored_by: 'manual';
    app_version: string;
    written_at: string;
  };
};

export type BuildCanonicalInput = {
  filename: string;
  driveFileId?: string | null;
  probe: Probe;
  comments?: string;
  keywords?: readonly string[];
  markers: readonly Marker[];
  appVersion?: string;
  writtenAt?: string;
  /** Fields from a sidecar this build did not recognize (FR-023b, Principle II). */
  unknownFields?: Record<string, unknown>;
};

export function buildCanonical(input: BuildCanonicalInput): Canonical {
  const {
    filename,
    driveFileId,
    probe,
    comments,
    keywords,
    markers,
    appVersion,
    writtenAt,
  } = input;

  validateMarkers(markers, probe);

  return {
    schema_version: SCHEMA_VERSION,
    identity: {
      filename, // the identity (FR-021a) — a rename orphans the sidecars
      drive_file_id: driveFileId ?? null,
    },
    technical: {
      codec: probe.codec,
      width: probe.width,
      height: probe.height,
      frame_rate: probe.frameRate, // exact rational, never a decimal
      duration_frames: probe.durationFrames,
      rate_mode: probe.rateMode,
      source_timecode_frames: probe.sourceTimecodeFrames, // null = absent
    },
    authored: {
      comments: comments ?? '',
      keywords: [...(keywords ?? [])].sort(), // sorted for determinism
    },
    markers: orderMarkers(markers).map((m) => ({
      frame: m.frame,
      duration_frames: m.durationFrames ?? 0,
      name: m.name ?? '',
      note: m.note ?? '',
      color: m.color,
    })),
    provenance: {
      authored_by: 'manual', // FR-018
      app_version: appVersion ?? '0.0.0-spike',
      written_at: writtenAt ?? new Date().toISOString(),
    },
  };
}

/**
 * Byte-stable serialization. Identical canonical content MUST produce identical
 * bytes (SC-010, Principle III). Key order comes from insertion order above;
 * two-space indent and a trailing newline match the spike's verified output.
 */
export const serializeCanonical = (c: Canonical): string => JSON.stringify(c, null, 2) + '\n';

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export type ParseWarning = { field: string; message: string };

export type ParsedCanonical = {
  comments: string;
  keywords: string[];
  markers: Marker[];
  schemaVersion: number | null;
  /** Everything this build did not recognize, preserved verbatim (FR-023b). */
  unknownFields: Record<string, unknown>;
  warnings: ParseWarning[];
};

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Lenient read: take every field we understand, skip what is malformed, and
 * report warnings rather than throwing (FR-023a).
 *
 * The schema version is recorded but is NOT a gate (Principle III: "Schema
 * versions MUST be recorded, and MUST be diagnostic rather than a gate on
 * reading"). A sidecar from a newer build still opens; we read what we can and
 * preserve the rest.
 *
 * This never throws on content. A sidecar the user authored is not something to
 * reject wholesale because one marker has a colour we don't know.
 */
export function parseCanonical(raw: unknown): ParsedCanonical {
  const warnings: ParseWarning[] = [];

  if (!isObject(raw)) {
    return {
      comments: '',
      keywords: [],
      markers: [],
      schemaVersion: null,
      unknownFields: {},
      warnings: [{ field: '/', message: 'Sidecar is not a JSON object; ignoring it.' }],
    };
  }

  const schemaVersion =
    typeof raw.schema_version === 'number' ? raw.schema_version : null;
  if (schemaVersion === null) {
    warnings.push({
      field: 'schema_version',
      message: 'Missing schema version; reading anyway.',
    });
  } else if (schemaVersion > SCHEMA_VERSION) {
    warnings.push({
      field: 'schema_version',
      message:
        `This sidecar was written by a newer version of Rushmark ` +
        `(schema ${schemaVersion}, this build understands ${SCHEMA_VERSION}). ` +
        `Fields it does not recognize are preserved and written back untouched.`,
    });
  }

  const authored = isObject(raw.authored) ? raw.authored : {};

  let comments = '';
  if (typeof authored.comments === 'string') {
    comments = authored.comments;
  } else if (authored.comments !== undefined) {
    warnings.push({ field: 'authored.comments', message: 'Not a string; ignored.' });
  }

  let keywords: string[] = [];
  if (Array.isArray(authored.keywords)) {
    keywords = authored.keywords.filter((k): k is string => typeof k === 'string');
    if (keywords.length !== authored.keywords.length) {
      warnings.push({
        field: 'authored.keywords',
        message: 'Some keywords were not strings and were ignored.',
      });
    }
  } else if (authored.keywords !== undefined) {
    warnings.push({ field: 'authored.keywords', message: 'Not an array; ignored.' });
  }

  const markers: Marker[] = [];
  if (Array.isArray(raw.markers)) {
    raw.markers.forEach((m: unknown, index: number) => {
      if (!isObject(m)) {
        warnings.push({ field: `markers[${index}]`, message: 'Not an object; skipped.' });
        return;
      }
      if (!Number.isInteger(m.frame)) {
        // A marker without an exact integer frame is exactly what Principle I
        // says never to guess at. Skip it and say so.
        warnings.push({
          field: `markers[${index}].frame`,
          message: 'Frame is not an integer; marker skipped rather than approximated.',
        });
        return;
      }
      if (!isMarkerColor(m.color)) {
        warnings.push({
          field: `markers[${index}].color`,
          message: `Unknown colour "${String(m.color)}"; skipped.`,
        });
        return;
      }
      markers.push({
        id: typeof m.id === 'string' ? m.id : `m${index}`,
        frame: m.frame as number,
        durationFrames: Number.isInteger(m.duration_frames)
          ? (m.duration_frames as number)
          : 0,
        name: typeof m.name === 'string' ? m.name : '',
        note: typeof m.note === 'string' ? m.note : '',
        color: m.color,
        sortIndex: index,
      });
    });
  } else if (raw.markers !== undefined) {
    warnings.push({ field: 'markers', message: 'Not an array; ignored.' });
  }

  return {
    comments,
    keywords,
    markers,
    schemaVersion,
    unknownFields: extractUnknownFields(raw),
    warnings,
  };
}
