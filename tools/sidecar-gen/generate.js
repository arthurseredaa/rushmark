#!/usr/bin/env node
// Phase 0 spike generator: video in -> .json + .csv + .otio beside it.
//
//   node generate.js <video> [--markers 0,120,last] [--csv-variant default]
//                            [--note-in-name] [--dry-run]
//
// Sidecars are written next to the video so the .otio's relative target_url
// resolves. Same logic that ships in src/domain/projections/.

import { writeFileSync, existsSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { probe } from './src/probe.js';
import { buildCanonical, serializeCanonical, PALETTE } from './src/canonical.js';
import { buildCsv, csvVariants } from './src/csv.js';
import { buildOtio, serializeOtio } from './src/otio.js';

function parseArgs(argv) {
  const args = { markers: "0,middle,last", csvVariant: "default", noteInName: false, dryRun: false, bom: false, urlForm: "name", markerBase: "tc" };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--markers') args.markers = argv[++i];
    else if (a === '--csv-variant') args.csvVariant = argv[++i];
    else if (a === '--note-in-name') args.noteInName = true;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--bom') args.bom = true;
    else if (a === '--url-form') args.urlForm = argv[++i];
    else if (a === '--marker-base') args.markerBase = argv[++i];
    else rest.push(a);
  }
  args.video = rest[0];
  return args;
}

/** Resolve "0,middle,last" against the real frame count. */
function resolveFrames(spec, durationFrames) {
  return spec.split(',').map((tok) => {
    const t = tok.trim().toLowerCase();
    if (t === 'last') return durationFrames - 1;
    if (t === 'middle' || t === 'mid') return Math.floor(durationFrames / 2);
    if (t === 'first') return 0;
    const n = Number(t);
    if (!Number.isInteger(n)) throw new Error(`bad marker frame: "${tok}"`);
    return n;
  });
}

const NOTES = [
  'Cut in here',
  'Best delivery of the line',
  'Hold on this before the cut',
  'Check focus',
];

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.video) {
    console.error('usage: node generate.js <video> [--markers 0,middle,last] [--csv-variant <v>] [--note-in-name] [--dry-run]');
    console.error(`csv variants: ${csvVariants().join(', ')}`);
    process.exit(2);
  }
  const videoPath = resolve(args.video);
  if (!existsSync(videoPath)) {
    console.error(`no such file: ${videoPath}`);
    process.exit(2);
  }

  const filename = basename(videoPath);
  const folder = dirname(videoPath);

  console.log(`probing ${filename}`);
  const p = probe(videoPath);

  const rateStr = p.frameRate ? `${p.frameRate.num}/${p.frameRate.den}` : 'UNKNOWN';
  const rateApprox = p.frameRate ? (p.frameRate.num / p.frameRate.den).toFixed(6) : '—';
  console.log(`  codec       ${p.codec}  ${p.width}x${p.height}`);
  console.log(`  frame rate  ${rateStr}  (~${rateApprox} fps)   [exact rational]`);
  console.log(`  duration    ${p.durationFrames} frames`);
  console.log(`  timecode    ${p.sourceTimecodeFrames ?? 'ABSENT (null, not 0)'}`);
  console.log(`  rate mode   ${p.rateMode}`);

  if (p.rateMode !== 'constant') {
    console.error(`\n  rate mode is "${p.rateMode}" — markers will be refused (FR-019/FR-019a).`);
    if (p.rateMode === 'variable') {
      console.error('  This clip is variable frame rate; frame positions cannot be guaranteed.');
    }
  }

  const frames = resolveFrames(args.markers, p.durationFrames);
  const markers = frames.map((frame, i) => ({
    id: `m${i + 1}`,
    frame,
    // One range marker (the 2nd), rest are points — exercises FR-017.
    durationFrames: i === 1 ? Math.min(24, p.durationFrames - frame) : 0,
    name: `Marker ${i + 1} @ frame ${frame}`,
    note: NOTES[i % NOTES.length],
    color: PALETTE[i % PALETTE.length],
    sortIndex: i,
  }));

  const canonical = buildCanonical({
    filename,
    driveFileId: null,
    probe: p,
    comments: 'Spike test: verifying CSV metadata import and OTIO marker mapping.',
    keywords: ['spike', 'test', 'resolve-check'],
    markers,
    appVersion: '0.0.0-spike',
    // Fixed clock so repeat runs are byte-identical (SC-010).
    writtenAt: '2026-07-17T00:00:00Z',
  });

  const outputs = [
    [join(folder, `${filename}.json`), serializeCanonical(canonical)],
    [join(folder, `${filename}.csv`), buildCsv(canonical, { variant: args.csvVariant, bom: args.bom })],
    [
      join(folder, `${filename}.otio`),
      serializeOtio(
        buildOtio(canonical, {
          noteInName: args.noteInName,
          urlForm: args.urlForm,
          markerBase: args.markerBase,
          absoluteDir: folder,
        }),
      ),
    ],
  ];

  console.log('\nmarkers');
  for (const m of canonical.markers) {
    const kind = m.duration_frames ? `range +${m.duration_frames}f` : 'point';
    console.log(`  frame ${String(m.frame).padStart(6)}  ${m.color.padEnd(7)} ${kind.padEnd(12)} "${m.name}"`);
  }

  console.log(`\n${args.dryRun ? 'would write' : 'writing'} (csv variant: ${args.csvVariant})`);
  for (const [path, content] of outputs) {
    if (!args.dryRun) writeFileSync(path, content, 'utf8');
    console.log(`  ${basename(path)}  (${content.length} bytes)`);
  }

  console.log('\nVerify in Resolve:');
  for (const m of canonical.markers) {
    console.log(`  - marker "${m.color}" must land on frame ${m.frame} exactly`);
  }
}

main();
