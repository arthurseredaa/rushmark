/**
 * Regression: editing a marker used to eat almost everything typed.
 *
 * MarkerList held the marker *object* in state, so the sheet rendered a copy
 * frozen at the moment of the tap. Each keystroke updated the parent, the parent
 * produced a new marker — and the sheet went on showing the old one. A
 * controlled TextInput whose `value` never advances discards the input, so a
 * name typed as "wide shot" arrived as "w".
 *
 * This is the first test in the `component` project. It has to render: the
 * defect lived entirely in the wiring between two components, and every pure
 * function underneath it was already correct.
 *
 * `render` and `fireEvent` are awaited throughout — this version of RNTL runs
 * under React 19's async act, and without the await a state update is asserted
 * before it has been applied.
 */

import { fireEvent, render } from '@testing-library/react-native';
import * as React from 'react';

import type { Marker } from '@/domain/canonical';
import { MarkerList } from '@/features/editor/MarkerList';
import { updateMarker } from '@/features/editor/markerActions';

const RATE = { num: 24000, den: 1001 };

const aMarker = (over: Partial<Marker> = {}): Marker => ({
  id: 'm1',
  frame: 120,
  durationFrames: 0,
  name: '',
  note: '',
  color: 'RED',
  sortIndex: 0,
  ...over,
});

/**
 * Stands in for the video screen: owns the markers and re-renders on change,
 * exactly as the real parent does. Testing MarkerList against a static prop
 * would reproduce none of the bug.
 */
function Harness({
  initial,
  onMarkers,
}: {
  initial: Marker[];
  onMarkers?: (markers: readonly Marker[]) => void;
}): React.ReactElement {
  const [markers, setMarkers] = React.useState<readonly Marker[]>(initial);
  const report = React.useRef(onMarkers);
  report.current = onMarkers;

  React.useEffect(() => {
    report.current?.(markers);
  }, [markers]);

  return (
    <MarkerList
      markers={markers}
      rate={RATE}
      sourceTimecodeFrames={null}
      currentFrame={0}
      onSeek={() => {}}
      onChange={(id, patch) => setMarkers((m) => updateMarker(m, id, patch))}
      onDelete={() => {}}
    />
  );
}

describe('marker editing sheet', () => {
  it('keeps every character typed into the name', async () => {
    const view = await render(<Harness initial={[aMarker()]} />);
    await fireEvent.press(view.getByLabelText('Edit marker 120'));

    // One event per character, as a keyboard actually delivers them, re-querying
    // each time. A single fireEvent with the whole string would pass even
    // against the old code — the first keystroke was never the problem.
    let typed = '';
    for (const ch of 'wide shot') {
      typed += ch;
      await fireEvent.changeText(view.getByPlaceholderText('What is this?'), typed);
    }

    expect(view.getByPlaceholderText('What is this?').props.value).toBe('wide shot');
  });

  it('publishes the edited name to the parent and back into the row', async () => {
    const seen: Marker[][] = [];
    const view = await render(
      <Harness initial={[aMarker()]} onMarkers={(m) => seen.push([...m])} />,
    );
    await fireEvent.press(view.getByLabelText('Edit marker 120'));

    await fireEvent.changeText(view.getByPlaceholderText('What is this?'), 'wide shot');
    await fireEvent.press(view.getByRole('button', { name: 'Done' }));

    expect(seen[seen.length - 1]?.[0]?.name).toBe('wide shot');
    // The row previously kept its "Frame 120" fallback, because it had no name.
    expect(view.getByText('wide shot')).toBeTruthy();
  });

  it('applies a duration typed digit by digit, not its intermediate values', async () => {
    const seen: Marker[][] = [];
    const view = await render(
      <Harness initial={[aMarker()]} onMarkers={(m) => seen.push([...m])} />,
    );
    await fireEvent.press(view.getByLabelText('Edit marker 120'));

    for (const step of ['1', '12', '120']) {
      await fireEvent.changeText(view.getByPlaceholderText('0'), step);
    }

    // Nothing committed yet: "1" on the way to "120" is a valid integer, and
    // publishing it would turn a half-typed number into a one-frame range.
    expect(seen[seen.length - 1]?.[0]?.durationFrames).toBe(0);

    await fireEvent.press(view.getByRole('button', { name: 'Done' }));
    expect(seen[seen.length - 1]?.[0]?.durationFrames).toBe(120);
  });

  it('refuses a non-integer duration instead of rounding it', async () => {
    const seen: Marker[][] = [];
    const view = await render(
      <Harness
        initial={[aMarker({ durationFrames: 48 })]}
        onMarkers={(m) => seen.push([...m])}
      />,
    );
    await fireEvent.press(view.getByLabelText('Edit marker 120'));

    await fireEvent.changeText(view.getByPlaceholderText('0'), '2.5');
    await fireEvent.press(view.getByRole('button', { name: 'Done' }));

    // Principle I: 2.5 frames is not a thing, and 2 or 3 would be a guess.
    expect(seen[seen.length - 1]?.[0]?.durationFrames).toBe(48);
  });

  it('re-seeds its drafts when a different marker is opened', async () => {
    const view = await render(
      <Harness
        initial={[
          aMarker({ id: 'm1', frame: 120, name: 'first' }),
          aMarker({ id: 'm2', frame: 240, name: 'second' }),
        ]}
      />,
    );

    await fireEvent.press(view.getByLabelText('Edit marker first'));
    expect(view.getByPlaceholderText('What is this?').props.value).toBe('first');
    await fireEvent.press(view.getByRole('button', { name: 'Done' }));

    await fireEvent.press(view.getByLabelText('Edit marker second'));
    expect(view.getByPlaceholderText('What is this?').props.value).toBe('second');
  });
});
