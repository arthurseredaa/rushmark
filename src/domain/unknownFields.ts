/**
 * Preserve what we do not understand.
 *
 * Constitution Principle II: "Fields the app does not recognize MUST be
 * preserved verbatim on read and written back unchanged on save."
 *
 * The failure this prevents is subtle and entirely self-inflicted: an older
 * build reads a sidecar written by a newer one, does not recognize half of it,
 * and on the next save writes back only what it knew about — silently deleting
 * the user's work on their behalf. FR-023b.
 */

type Json = Record<string, unknown>;

const isPlainObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The shape this schema version understands. A `true` leaf means "recognized,
 * stop here"; a nested object means "recurse and check the children".
 *
 * `markers` is deliberately a leaf: markers are a wholly-owned array that the
 * app rewrites in full, so per-element diffing would be a false promise.
 */
const KNOWN: Record<string, unknown> = {
  schema_version: true,
  identity: { filename: true, drive_file_id: true },
  technical: {
    codec: true,
    width: true,
    height: true,
    frame_rate: true,
    duration_frames: true,
    rate_mode: true,
    source_timecode_frames: true,
  },
  authored: {
    comments: true,
    keywords: true,
    description: true,
    people: true,
    good_take: true,
  },
  markers: true,
  provenance: { authored_by: true, app_version: true, written_at: true },
};

/**
 * Everything in `raw` that this build does not recognize, preserved verbatim
 * with its nesting intact. Returns an empty object when nothing is unknown.
 */
export function extractUnknownFields(raw: unknown, known: unknown = KNOWN): Json {
  if (!isPlainObject(raw) || !isPlainObject(known)) return {};

  const out: Json = {};
  for (const [key, value] of Object.entries(raw)) {
    const spec = known[key];

    if (spec === undefined) {
      out[key] = value; // wholly unrecognized — keep it, untouched
      continue;
    }
    if (spec === true) continue; // recognized leaf

    if (isPlainObject(spec) && isPlainObject(value)) {
      const nested = extractUnknownFields(value, spec);
      if (Object.keys(nested).length > 0) out[key] = nested;
    }
  }
  return out;
}

/**
 * Deep-merge preserved fields back into a freshly built canonical.
 *
 * Known fields always win: the app's current state is authoritative for
 * everything it understands. Unknown fields fill in around it. This asymmetry is
 * the point — preservation must never let stale data override an actual edit.
 */
export function mergeUnknownFields<T extends Json>(canonical: T, unknown: Json): T {
  if (!isPlainObject(unknown) || Object.keys(unknown).length === 0) return canonical;

  const merge = (base: Json, extra: Json): Json => {
    const out: Json = { ...base };
    for (const [key, value] of Object.entries(extra)) {
      const current = out[key];
      if (isPlainObject(current) && isPlainObject(value)) {
        out[key] = merge(current, value);
      } else if (!(key in out)) {
        out[key] = value;
      }
      // else: the app knows this key — its value stands.
    }
    return out;
  };

  return merge(canonical, unknown) as T;
}
