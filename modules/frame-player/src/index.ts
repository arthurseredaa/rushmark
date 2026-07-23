/**
 * Typed JS interface to the frame-exact AVFoundation player.
 * See specs/001-drive-video-metadata/contracts/native-player.md.
 *
 * The interface speaks INTEGER FRAMES only. There is no seconds-based API here,
 * and adding one would violate Principle I — a float crossing this bridge
 * destroys exactness before the domain layer ever sees the value, which is
 * precisely why every off-the-shelf RN player was rejected (D2).
 */

import { requireNativeModule, requireNativeViewManager } from 'expo-modules-core';
import * as React from 'react';
import type { ViewProps } from 'react-native';

import type { Probe, RateMode } from '@/domain/canonical';
import type { Rational } from '@/domain/rational';

/** Exactly what MediaProbe.swift returns. Rate is a rational PAIR, never a float. */
export type NativeProbe = {
  codec: string;
  width: number;
  height: number;
  frameRate: Rational;
  durationFrames: number;
  rateMode: RateMode;
  sourceTimecodeFrames: number | null;
};

type FramePlayerNativeModule = {
  probe(uri: string): Promise<NativeProbe>;
  load(handleId: string, uri: string): Promise<NativeProbe>;
  loadRemote(
    handleId: string,
    uri: string,
    headers: Record<string, string>,
  ): Promise<NativeProbe>;
  unload(handleId: string): Promise<void>;
  /** Resolves with the frame ACTUALLY landed on, which may differ from `frame`. */
  seekToFrame(handleId: string, frame: number): Promise<number>;
  /** Fast, openly approximate seek for dragging a timeline. */
  scrubToFrame(handleId: string, frame: number): Promise<number>;
  /** Resolves with the frame actually landed on. */
  stepByFrames(handleId: string, count: number): Promise<number>;
  currentFrame(handleId: string): Promise<number>;
  play(handleId: string): Promise<void>;
  pause(handleId: string): Promise<void>;
  addListener(event: string, listener: (payload: unknown) => void): { remove(): void };
};

const native = requireNativeModule<FramePlayerNativeModule>('FramePlayer');

const NativeView: React.ComponentType<ViewProps & { handleId: string }> =
  requireNativeViewManager('FramePlayer');

/** Read a file's technical facts without loading a player. */
export const probe = (uri: string): Promise<NativeProbe> => native.probe(uri);

/** Convert a native probe into the domain's Probe. Same shape, distinct type. */
export const toDomainProbe = (p: NativeProbe): Probe => ({
  codec: p.codec,
  width: p.width,
  height: p.height,
  frameRate: p.frameRate,
  durationFrames: p.durationFrames,
  rateMode: p.rateMode,
  sourceTimecodeFrames: p.sourceTimecodeFrames,
});

const newHandleId = (): string =>
  `fp_${Date.now()}_${Math.random().toString(36).slice(2)}`;

export class FramePlayer {
  private constructor(
    readonly handleId: string,
    readonly probeResult: NativeProbe,
    /** True when the media is being read over the network rather than off disk. */
    readonly streaming: boolean,
  ) {}

  static async load(uri: string): Promise<FramePlayer> {
    const handleId = newHandleId();
    const probeResult = await native.load(handleId, uri);
    return new FramePlayer(handleId, probeResult, false);
  }

  /**
   * Play from a URL without downloading it first.
   *
   * The returned probe is shallow — `rateMode` is always `unknown` and there is
   * no source timecode — because confirming either means reading sample data the
   * network has not sent. Callers must not treat a streamed probe as the
   * canonical technical record, and must not place markers against it.
   */
  static async loadRemote(
    uri: string,
    headers: Record<string, string>,
  ): Promise<FramePlayer> {
    const handleId = newHandleId();
    const probeResult = await native.loadRemote(handleId, uri, headers);
    return new FramePlayer(handleId, probeResult, true);
  }

  /**
   * Seek to an exact frame with zero tolerance.
   *
   * Returns the frame actually landed on. Callers MUST use the return value as
   * the new position rather than assuming the request succeeded — Principle I:
   * "A seek or step MUST report the frame it actually landed on."
   */
  seekToFrame(frame: number): Promise<number> {
    if (!Number.isInteger(frame)) {
      throw new Error(`seekToFrame requires an integer frame: ${frame}`);
    }
    return native.seekToFrame(this.handleId, frame);
  }

  /**
   * Approximate seek, for the live part of a timeline drag.
   *
   * Returns roughly where playback landed — within about half a second. The
   * result is for showing a picture under the finger and MUST NOT be used as a
   * marker position: commit a drag with `seekToFrame` and use that value.
   */
  scrubToFrame(frame: number): Promise<number> {
    if (!Number.isInteger(frame)) {
      throw new Error(`scrubToFrame requires an integer frame: ${frame}`);
    }
    return native.scrubToFrame(this.handleId, frame);
  }

  /** Step by whole frames. Returns the frame actually landed on. */
  stepByFrames(count: number): Promise<number> {
    if (!Number.isInteger(count)) {
      throw new Error(`stepByFrames requires an integer count: ${count}`);
    }
    return native.stepByFrames(this.handleId, count);
  }

  currentFrame(): Promise<number> {
    return native.currentFrame(this.handleId);
  }

  play(): Promise<void> {
    return native.play(this.handleId);
  }

  pause(): Promise<void> {
    return native.pause(this.handleId);
  }

  unload(): Promise<void> {
    return native.unload(this.handleId);
  }
}

export const onFrameChanged = (
  listener: (payload: { handleId: string; frame: number }) => void,
): { remove(): void } =>
  native.addListener('onFrameChanged', listener as (payload: unknown) => void);

export const onPlaybackStateChanged = (
  listener: (payload: { handleId: string; playing: boolean }) => void,
): { remove(): void } =>
  native.addListener('onPlaybackStateChanged', listener as (payload: unknown) => void);

export type FramePlayerViewProps = ViewProps & { handleId: string };

export const FramePlayerView = (props: FramePlayerViewProps): React.ReactElement =>
  React.createElement(NativeView, props);
