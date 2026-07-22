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
  unload(handleId: string): Promise<void>;
  /** Resolves with the frame ACTUALLY landed on, which may differ from `frame`. */
  seekToFrame(handleId: string, frame: number): Promise<number>;
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

export class FramePlayer {
  private constructor(
    readonly handleId: string,
    readonly probeResult: NativeProbe,
  ) {}

  static async load(uri: string): Promise<FramePlayer> {
    const handleId = `fp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const probeResult = await native.load(handleId, uri);
    return new FramePlayer(handleId, probeResult);
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
