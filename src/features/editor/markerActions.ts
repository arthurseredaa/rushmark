/**
 * Marker CRUD, as pure functions over the marker list (FR-015, FR-016, FR-017).
 *
 * Kept out of the component so the rules are testable without rendering, and so
 * the component cannot quietly grow its own subtly different version.
 */

import type { Marker, MarkerColor } from '@/domain/canonical';
import { PALETTE } from '@/domain/canonical';
import { orderMarkers } from '@/domain/markers';

const newId = (): string =>
  `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

/**
 * Cycle the palette so consecutive markers are visually distinct without the
 * user having to choose a colour every time.
 */
const nextColor = (markers: readonly Marker[]): MarkerColor =>
  PALETTE[markers.length % PALETTE.length] ?? 'RED';

export function addMarker(
  markers: readonly Marker[],
  input: { frame: number; name?: string; color?: MarkerColor },
): Marker[] {
  if (!Number.isInteger(input.frame)) {
    throw new Error(`marker frame must be an integer: ${input.frame}`);
  }

  const marker: Marker = {
    id: newId(),
    frame: input.frame,
    durationFrames: 0,
    name: input.name ?? '',
    note: '',
    color: input.color ?? nextColor(markers),
    // Ties on the same frame resolve by insertion order, so a later marker on an
    // occupied frame sorts after the earlier one rather than by id chance.
    sortIndex: markers.filter((m) => m.frame === input.frame).length,
  };

  return orderMarkers([...markers, marker]);
}

export function updateMarker(
  markers: readonly Marker[],
  id: string,
  patch: Partial<Omit<Marker, 'id'>>,
): Marker[] {
  return orderMarkers(
    markers.map((m) => (m.id === id ? { ...m, ...patch } : m)),
  );
}

export function deleteMarker(markers: readonly Marker[], id: string): Marker[] {
  return markers.filter((m) => m.id !== id);
}

/** The marker at exactly this frame, if any — for "you are on a marker" UI. */
export const markerAtFrame = (
  markers: readonly Marker[],
  frame: number,
): Marker | undefined => markers.find((m) => m.frame === frame);

/** Nearest marker at or before `frame`, for jump-to-previous. */
export const previousMarker = (
  markers: readonly Marker[],
  frame: number,
): Marker | undefined =>
  [...orderMarkers(markers)].reverse().find((m) => m.frame < frame);

/** Nearest marker after `frame`, for jump-to-next. */
export const nextMarker = (
  markers: readonly Marker[],
  frame: number,
): Marker | undefined => orderMarkers(markers).find((m) => m.frame > frame);
