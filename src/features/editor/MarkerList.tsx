/**
 * The marker list and its editor sheet (FR-015, FR-016, FR-017).
 */

import * as React from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { PALETTE, type Marker, type MarkerColor } from '@/domain/canonical';
import type { Rational } from '@/domain/rational';
import { framesToTimecode } from '@/domain/timecode';
import { Button, DoneInput, Empty } from '@/ui/components';
import { MARKER_SWATCH, spacing, theme } from '@/ui/theme';

export function MarkerList({
  markers,
  rate,
  sourceTimecodeFrames,
  currentFrame,
  onSeek,
  onChange,
  onDelete,
}: {
  markers: readonly Marker[];
  rate: Rational;
  sourceTimecodeFrames: number | null;
  currentFrame: number;
  onSeek: (frame: number) => void;
  onChange: (id: string, patch: Partial<Omit<Marker, 'id'>>) => void;
  onDelete: (id: string) => void;
}): React.ReactElement {
  /**
   * The ID, not the marker.
   *
   * Holding the object froze a copy taken at the moment of the tap: every edit
   * went to the parent, the parent produced a new marker, and the sheet went on
   * rendering the stale one. A controlled TextInput whose `value` never changes
   * rejects almost everything typed into it — which is exactly what it looked
   * like. Deriving from `markers` means the sheet always sees the live marker,
   * and it also disappears correctly if the marker is removed underneath it.
   */
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const editing = markers.find((m) => m.id === editingId) ?? null;

  if (markers.length === 0) {
    return (
      <Empty
        title="No markers yet"
        detail="Step to a frame and tap “Add marker” to flag it."
      />
    );
  }

  return (
    <View style={styles.list}>
      {markers.map((m) => (
        <Pressable
          key={m.id}
          accessibilityRole="button"
          style={[styles.row, currentFrame === m.frame && styles.rowCurrent]}
          onPress={() => onSeek(m.frame)}
          onLongPress={() => setEditingId(m.id)}
        >
          <View style={[styles.swatch, { backgroundColor: MARKER_SWATCH[m.color] }]} />
          <View style={styles.rowMain}>
            <Text style={styles.rowTitle} numberOfLines={1}>
              {m.name || `Frame ${m.frame}`}
            </Text>
            <Text style={styles.rowMeta}>
              {/* Timecode shown in MEDIA coordinates so it matches what the editor
                  will display — the same offset the OTIO projection applies (F13). */}
              {framesToTimecode((sourceTimecodeFrames ?? 0) + m.frame, rate)}
              {m.durationFrames ? `  ·  ${m.durationFrames}f range` : ''}
              {m.note ? `  ·  ${m.note}` : ''}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Edit marker ${m.name || m.frame}`}
            onPress={() => setEditingId(m.id)}
            hitSlop={8}
          >
            <Text style={styles.edit}>Edit</Text>
          </Pressable>
        </Pressable>
      ))}

      {editing ? (
        // Keyed by marker id so opening a different marker remounts the sheet
        // and re-seeds its drafts. Without the key the drafts would carry over
        // from whichever marker was edited last.
        <MarkerSheet
          key={editing.id}
          marker={editing}
          rate={rate}
          sourceTimecodeFrames={sourceTimecodeFrames}
          onClose={() => setEditingId(null)}
          onChange={onChange}
          onDelete={(id) => {
            setEditingId(null);
            onDelete(id);
          }}
        />
      ) : null}
    </View>
  );
}

function MarkerSheet({
  marker,
  rate,
  sourceTimecodeFrames,
  onClose,
  onChange,
  onDelete,
}: {
  marker: Marker;
  rate: Rational;
  sourceTimecodeFrames: number | null;
  onClose: () => void;
  onChange: (id: string, patch: Partial<Omit<Marker, 'id'>>) => void;
  onDelete: (id: string) => void;
}): React.ReactElement {
  /**
   * The text fields render from local drafts, not from the marker.
   *
   * Every keystroke still reaches the parent immediately — Principle II, nothing
   * typed is held hostage until some later commit. But what the field *displays*
   * must not depend on a round trip through the whole video screen, which now
   * re-renders ten times a second from the playhead observer. Feeding a
   * controlled input from that far away is how characters get eaten.
   *
   * Seeded lazily and never re-seeded: the parent keys this component by marker
   * id, so a different marker is a different mount.
   */
  const [name, setName] = React.useState(() => marker.name ?? '');
  const [note, setNote] = React.useState(() => marker.note ?? '');
  const [duration, setDuration] = React.useState(() =>
    String(marker.durationFrames ?? 0),
  );

  const commitDuration = (): void => {
    const trimmed = duration.trim();
    const parsed = Number(trimmed);
    // Refuse rather than coerce: "2.5 frames" is not a thing, and rounding it
    // would be exactly the silent approximation Principle I forbids.
    if (trimmed === '' || !Number.isInteger(parsed) || parsed < 0) {
      setDuration(String(marker.durationFrames ?? 0));
      return;
    }
    onChange(marker.id, { durationFrames: parsed });
  };

  /**
   * Duration is the one field that cannot publish per keystroke — "1" on the way
   * to "120" is a valid number and would be applied. So it commits on the way
   * out, and every exit goes through here: Done, the backdrop, and the hardware
   * back gesture. Dismissing must not be a way to lose a typed value.
   */
  const close = (): void => {
    commitDuration();
    onClose();
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close} />
      <KeyboardAvoidingView behavior="padding" style={styles.sheet}>
        <ScrollView
          contentContainerStyle={styles.sheetBody}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.sheetTitle}>
            Marker at {framesToTimecode((sourceTimecodeFrames ?? 0) + marker.frame, rate)}
          </Text>
          <Text style={styles.sheetSub}>Frame {marker.frame} of the source</Text>

          <Text style={styles.label}>Name</Text>
          <DoneInput
            style={styles.input}
            value={name}
            onChangeText={(v) => {
              setName(v);
              onChange(marker.id, { name: v });
            }}
            placeholder="What is this?"
            placeholderTextColor={theme.textDim}
          />

          <Text style={styles.label}>Note</Text>
          <DoneInput
            style={[styles.input, styles.note]}
            value={note}
            onChangeText={(v) => {
              setNote(v);
              onChange(marker.id, { note: v });
            }}
            placeholder="Anything worth remembering here"
            placeholderTextColor={theme.textDim}
            multiline
            textAlignVertical="top"
          />

          <Text style={styles.label}>Duration (frames) — 0 for a point marker</Text>
          <DoneInput
            style={styles.input}
            value={duration}
            onChangeText={setDuration}
            onBlur={commitDuration}
            onSubmitEditing={commitDuration}
            keyboardType="number-pad"
            placeholder="0"
            placeholderTextColor={theme.textDim}
          />

          <Text style={styles.label}>Colour</Text>
          <View style={styles.palette}>
            {PALETTE.map((color: MarkerColor) => (
              <Pressable
                key={color}
                accessibilityRole="button"
                accessibilityLabel={color}
                accessibilityState={{ selected: marker.color === color }}
                onPress={() => onChange(marker.id, { color })}
                style={[
                  styles.paletteSwatch,
                  { backgroundColor: MARKER_SWATCH[color] },
                  marker.color === color && styles.paletteSelected,
                ]}
              />
            ))}
          </View>

          <View style={styles.sheetActions}>
            <Button label="Done" onPress={close} />
            <Button label="Delete marker" variant="danger" onPress={() => onDelete(marker.id)} />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: theme.surface,
    borderRadius: 8,
    padding: spacing.md,
  },
  rowCurrent: { borderWidth: 1, borderColor: theme.accent },
  swatch: { width: 4, alignSelf: 'stretch', borderRadius: 2 },
  rowMain: { flex: 1 },
  rowTitle: { color: theme.text, fontSize: 14, fontWeight: '500' },
  rowMeta: { color: theme.textDim, fontSize: 12, marginTop: 2, fontVariant: ['tabular-nums'] },
  edit: { color: theme.accent, fontSize: 13 },
  backdrop: { flex: 1, backgroundColor: '#000a' },
  sheet: {
    backgroundColor: theme.bg,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '80%',
  },
  sheetBody: { padding: spacing.xl, gap: spacing.sm },
  sheetTitle: { color: theme.text, fontSize: 18, fontWeight: '700', fontVariant: ['tabular-nums'] },
  sheetSub: { color: theme.textDim, fontSize: 13 },
  label: {
    color: theme.textDim,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    marginTop: spacing.md,
  },
  input: {
    backgroundColor: theme.surface,
    color: theme.text,
    borderRadius: 8,
    padding: spacing.md,
    fontSize: 15,
  },
  note: { minHeight: 70 },
  palette: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  paletteSwatch: { width: 36, height: 36, borderRadius: 18 },
  paletteSelected: { borderWidth: 3, borderColor: theme.text },
  sheetActions: { gap: spacing.sm, marginTop: spacing.xl },
});
