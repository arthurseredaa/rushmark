// CSV projection — Resolve whole-video metadata. See contracts/resolve-csv.md.
//
// CONFIRMED against Resolve 2026-07-17: headers "File Name", "Comments",
// "Keywords" are correct; comma-space separator yields separate keyword chips;
// a UTF-8 BOM BREAKS matching (its bytes attach to the first header).

import { framesToTimecode } from './timecode.js';

/** RFC 4180: quote if the field contains a comma, quote, or newline. */
function esc(value) {
  const s = String(value ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const VARIANTS = {
  default: { fileName: 'File Name', comments: 'Comments', keywords: 'Keywords' },
  clipName: { fileName: 'Clip Name', comments: 'Comments', keywords: 'Keywords' },
  lowercase: { fileName: 'File name', comments: 'Comments', keywords: 'Keywords' },
  description: { fileName: 'File Name', comments: 'Description', keywords: 'Keywords' },
};

/**
 * Resolve's Metadata Import ships with "Match using clip start and end
 * Timecode" TICKED. A CSV without timecode columns therefore matches nothing
 * and reports "No matching media pool entries were found" — a message that
 * blames the media pool rather than the checkbox. Emitting Start/End TC makes
 * the import work under Resolve's DEFAULT options, so the user never has to
 * remember a setting whose failure mode is misleading.
 *
 * End TC is EXCLUSIVE (start + duration), matching Resolve's own display:
 * a 247-frame clip from 18:52:38:16 reports End TC 18:52:48:23.
 */
function timecodeColumns(canonical) {
  const t = canonical.technical;
  if (t.source_timecode_frames === null || !t.frame_rate) return null;
  return {
    startTc: framesToTimecode(t.source_timecode_frames, t.frame_rate),
    endTc: framesToTimecode(t.source_timecode_frames + t.duration_frames, t.frame_rate),
  };
}

export function buildCsv(canonical, { variant = 'default', separator = ', ', bom = false, timecode = true } = {}) {
  const h = VARIANTS[variant];
  if (!h) throw new Error(`unknown CSV variant: ${variant}`);

  const headers = [h.fileName, h.comments, h.keywords];
  const values = [
    canonical.identity.filename, // matched by filename (FR-021a)
    canonical.authored.comments,
    canonical.authored.keywords.join(separator),
  ];

  const tc = timecode ? timecodeColumns(canonical) : null;
  if (tc) {
    headers.push('Start TC', 'End TC');
    values.push(tc.startTc, tc.endTc);
  }

  // Markers are deliberately absent — CSV cannot carry them (FR-031).
  const body = `${headers.map(esc).join(',')}\r\n${values.map(esc).join(',')}\r\n`;

  // BOM defaults OFF: it breaks header matching (F7). Exposed only so the
  // non-ASCII question can be tested.
  return (bom ? '﻿' : '') + body;
}

export const csvVariants = () => Object.keys(VARIANTS);
