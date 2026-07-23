/**
 * A draggable timeline for the preview (FR-007a).
 *
 * The one place in the app where a float touches a frame path, and it is
 * confined here on purpose: a finger position is inherently fractional, so the
 * fraction is converted to an integer frame at the moment it is read and never
 * carried any further. Nothing downstream sees anything but an integer.
 *
 * The rounding is the boundary Principle I permits — a gesture is an input, not
 * a measurement. What the constitution forbids is approximating a position the
 * app then *asserts*, and this component asserts nothing: the parent commits a
 * drag through an exact seek and uses the frame the player reports it landed on.
 */

import * as React from 'react';
import { PanResponder, StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import { theme } from '@/ui/theme';

export function Scrubber({
  frame,
  durationFrames,
  disabled = false,
  onScrub,
  onCommit,
}: {
  /** Current playhead, in frames. Ignored while the user is dragging. */
  frame: number;
  durationFrames: number;
  disabled?: boolean;
  /** Fired continuously during a drag, with an integer frame. */
  onScrub: (frame: number) => void;
  /** Fired once when the finger lifts, with the integer frame to settle on. */
  onCommit: (frame: number) => void;
}): React.ReactElement {
  const [width, setWidth] = React.useState(0);
  const [dragFrame, setDragFrame] = React.useState<number | null>(null);

  const lastFrame = Math.max(0, durationFrames - 1);

  // Refs, not state: the PanResponder is created once and would otherwise close
  // over the first render's values forever.
  const widthRef = React.useRef(0);
  const lastFrameRef = React.useRef(lastFrame);
  const onScrubRef = React.useRef(onScrub);
  const onCommitRef = React.useRef(onCommit);
  const disabledRef = React.useRef(disabled);

  widthRef.current = width;
  lastFrameRef.current = lastFrame;
  onScrubRef.current = onScrub;
  onCommitRef.current = onCommit;
  disabledRef.current = disabled;

  const frameAt = (x: number): number => {
    const w = widthRef.current;
    if (w <= 0) return 0;
    const fraction = Math.min(1, Math.max(0, x / w));
    // See the file header: a touch coordinate is an input, and this is the one
    // line where it becomes an integer frame. Nothing fractional escapes.
    return Math.round(fraction * lastFrameRef.current);
  };

  const responder = React.useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !disabledRef.current,
        onMoveShouldSetPanResponder: () => !disabledRef.current,
        // Claim the gesture so the surrounding ScrollView does not steal it.
        onPanResponderTerminationRequest: () => false,

        onPanResponderGrant: (evt) => {
          const f = frameAt(evt.nativeEvent.locationX);
          setDragFrame(f);
          onScrubRef.current(f);
        },
        onPanResponderMove: (evt) => {
          // locationX stays relative to this view even once the finger leaves
          // it, which is exactly what we want — it just clamps at the ends.
          const f = frameAt(evt.nativeEvent.locationX);
          setDragFrame(f);
          onScrubRef.current(f);
        },
        onPanResponderRelease: (evt) => {
          const f = frameAt(evt.nativeEvent.locationX);
          setDragFrame(null);
          onCommitRef.current(f);
        },
        onPanResponderTerminate: () => {
          setDragFrame(null);
        },
      }),
    [],
  );

  const shown = dragFrame ?? frame;
  const fraction = lastFrame > 0 ? Math.min(1, Math.max(0, shown / lastFrame)) : 0;

  return (
    <View
      style={styles.hitArea}
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
      accessibilityRole="adjustable"
      accessibilityLabel="Playback position"
      accessibilityValue={{ min: 0, max: lastFrame, now: shown }}
      {...responder.panHandlers}
    >
      <View style={[styles.track, disabled && styles.trackDisabled]}>
        <View style={[styles.fill, { width: `${fraction * 100}%` }]} />
      </View>
      {!disabled ? (
        <View
          pointerEvents="none"
          style={[
            styles.knob,
            { left: `${fraction * 100}%` },
            dragFrame !== null && styles.knobHeld,
          ]}
        />
      ) : null}
    </View>
  );
}

const KNOB = 16;

const styles = StyleSheet.create({
  // Deliberately taller than the visible bar: a 4pt line is not a touch target.
  hitArea: { height: 44, justifyContent: 'center', alignSelf: 'stretch' },
  track: {
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.surfaceRaised,
    overflow: 'hidden',
  },
  trackDisabled: { opacity: 0.4 },
  fill: { height: 4, backgroundColor: theme.accent },
  knob: {
    position: 'absolute',
    width: KNOB,
    height: KNOB,
    borderRadius: KNOB / 2,
    marginLeft: -KNOB / 2,
    backgroundColor: theme.text,
  },
  knobHeld: { transform: [{ scale: 1.3 }] },
});
