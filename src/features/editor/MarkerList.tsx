/**
 * The marker list and its editor sheet (FR-015, FR-016, FR-017).
 */

import * as React from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { PALETTE, type Marker, type MarkerColor } from '@/domain/canonical';
import type { Rational } from '@/domain/rational';
import { framesToTimecode } from '@/domain/timecode';
import { Button, Empty } from '@/ui/components';
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
  const [editing, setEditing] = React.useState<Marker | null>(null);

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
          onLongPress={() => setEditing(m)}
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
            onPress={() => setEditing(m)}
            hitSlop={8}
          >
            <Text style={styles.edit}>Edit</Text>
          </Pressable>
        </Pressable>
      ))}

      <MarkerSheet
        marker={editing}
        rate={rate}
        sourceTimecodeFrames={sourceTimecodeFrames}
        onClose={() => setEditing(null)}
        onChange={onChange}
        onDelete={(id) => {
          setEditing(null);
          onDelete(id);
        }}
      />
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
  marker: Marker | null;
  rate: Rational;
  sourceTimecodeFrames: number | null;
  onClose: () => void;
  onChange: (id: string, patch: Partial<Omit<Marker, 'id'>>) => void;
  onDelete: (id: string) => void;
}): React.ReactElement | null {
  const [duration, setDuration] = React.useState('');

  React.useEffect(() => {
    setDuration(marker ? String(marker.durationFrames ?? 0) : '');
  }, [marker]);

  if (!marker) return null;

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

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <ScrollView contentContainerStyle={styles.sheetBody}>
          <Text style={styles.sheetTitle}>
            Marker at {framesToTimecode((sourceTimecodeFrames ?? 0) + marker.frame, rate)}
          </Text>
          <Text style={styles.sheetSub}>Frame {marker.frame} of the source</Text>

          <Text style={styles.label}>Name</Text>
          <TextInput
            style={styles.input}
            value={marker.name ?? ''}
            onChangeText={(v) => onChange(marker.id, { name: v })}
            placeholder="What is this?"
            placeholderTextColor={theme.textDim}
          />

          <Text style={styles.label}>Note</Text>
          <TextInput
            style={[styles.input, styles.note]}
            value={marker.note ?? ''}
            onChangeText={(v) => onChange(marker.id, { note: v })}
            placeholder="Anything worth remembering here"
            placeholderTextColor={theme.textDim}
            multiline
            textAlignVertical="top"
          />

          <Text style={styles.label}>Duration (frames) — 0 for a point marker</Text>
          <TextInput
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
            <Button label="Done" onPress={onClose} />
            <Button label="Delete marker" variant="danger" onPress={() => onDelete(marker.id)} />
          </View>
        </ScrollView>
      </View>
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
