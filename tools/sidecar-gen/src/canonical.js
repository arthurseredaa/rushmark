// Canonical model — the source of truth. See contracts/canonical-json.md.

export const SCHEMA_VERSION = 1;
export const PALETTE = ['RED', 'GREEN', 'BLUE', 'CYAN', 'YELLOW', 'PINK', 'PURPLE'];

/** Total, stable order so identical content yields identical bytes (SC-010). */
const orderMarkers = (markers) =>
  [...markers].sort(
    (a, b) =>
      a.frame - b.frame ||
      (a.sortIndex ?? 0) - (b.sortIndex ?? 0) ||
      String(a.id).localeCompare(String(b.id)),
  );

export function validateMarkers(markers, probe) {
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
    if (!Number.isInteger(m.frame)) throw new Error(`marker frame must be an integer: ${m.frame}`);
    if (m.frame < 0 || m.frame >= probe.durationFrames) {
      throw new Error(`marker frame ${m.frame} out of bounds [0, ${probe.durationFrames - 1}]`);
    }
    const dur = m.durationFrames ?? 0;
    if (!Number.isInteger(dur) || dur < 0) throw new Error(`bad duration: ${dur}`);
    if (m.frame + dur > probe.durationFrames) {
      throw new Error(`marker ${m.frame}+${dur} extends past end (${probe.durationFrames})`);
    }
    if (!PALETTE.includes(m.color)) {
      throw new Error(`color "${m.color}" not in palette: ${PALETTE.join(', ')}`);
    }
  }
  return markers;
}

export function buildCanonical({ filename, driveFileId, probe, comments, keywords, markers, appVersion, writtenAt }) {
  validateMarkers(markers, probe);
  return {
    schema_version: SCHEMA_VERSION,
    identity: {
      filename, // the identity (FR-021a)
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

export const serializeCanonical = (c) => JSON.stringify(c, null, 2) + '\n';
