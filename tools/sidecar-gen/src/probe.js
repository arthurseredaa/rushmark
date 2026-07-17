// Read technical facts from a video file via ffprobe.
//
// Stands in for MediaProbe.swift (AVFoundation) in the app. Same contract:
// exact rational rate, integer frame count, explicit null for absent timecode.

import { execFileSync } from 'node:child_process';
import { parseRate } from './rational.js';

const ffprobe = (args) =>
  JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-of', 'json', ...args], {
    encoding: 'utf8',
  }));

/** Timecode "01:00:00:00" -> integer frames. Non-drop only. */
function timecodeToFrames(tc, rate) {
  const m = String(tc).match(/^(\d+):(\d+):(\d+)[:;](\d+)$/);
  if (!m) return null;
  const [h, min, s, f] = m.slice(1).map(Number);
  // Timecode counts labelled frames per second (24 for 23.976), not real time.
  const fps = Math.round(rate.num / rate.den);
  return ((h * 60 + min) * 60 + s) * fps + f;
}

/**
 * Pick the real footage track.
 *
 * Not just "the first video stream": real cameras embed cover art. A DJI Osmo
 * Pocket 3 file carries an MJPEG thumbnail stream reporting 90000/1 fps
 * alongside the actual HEVC track. Reading the rate off that would poison
 * every frame position downstream.
 */
function pickVideoStream(streams) {
  const candidates = streams.filter(
    (s) =>
      s.codec_type === 'video' &&
      s.disposition?.attached_pic !== 1 && // cover art
      s.codec_name !== 'mjpeg' && // thumbnail tracks
      Number(s.width) > 0,
  );
  if (!candidates.length) return null;
  // Largest frame area wins — the footage, not a preview.
  return candidates.sort((a, b) => b.width * b.height - a.width * a.height)[0];
}

export function probe(videoPath) {
  const { streams } = ffprobe([
    '-show_entries',
    'stream=index,codec_type,codec_name,width,height,r_frame_rate,avg_frame_rate,nb_frames,duration,disposition:stream_tags=timecode',
    videoPath,
  ]);
  const { format } = ffprobe(['-show_entries', 'format_tags=timecode', videoPath]);

  const video = pickVideoStream(streams);
  if (!video) {
    return { rateMode: 'unknown', frameRate: null, durationFrames: null };
  }

  // r_frame_rate is already a rational string — keep it that way.
  const frameRate = parseRate(video.r_frame_rate);

  // VFR heuristic for the spike: r_frame_rate (max) vs avg_frame_rate.
  // The app uses real sample timings via AVAssetReader (D3) — ffprobe's
  // averages are a weaker signal, adequate only for known-CFR test clips.
  let rateMode = 'constant';
  try {
    const avg = parseRate(video.avg_frame_rate);
    if (avg.num * frameRate.den !== frameRate.num * avg.den) rateMode = 'variable';
  } catch {
    rateMode = 'unknown';
  }

  const durationFrames = video.nb_frames
    ? Number(video.nb_frames)
    : Math.round((Number(video.duration) * frameRate.num) / frameRate.den);

  // Absent timecode stays null — never 0 (FR-012).
  const tc = video.tags?.timecode ?? format?.tags?.timecode ?? null;
  const sourceTimecodeFrames = tc ? timecodeToFrames(tc, frameRate) : null;

  return {
    codec: video.codec_name,
    width: Number(video.width),
    height: Number(video.height),
    frameRate,
    durationFrames,
    sourceTimecodeFrames,
    rateMode,
  };
}
