/**
 * Whole-video comments and keywords (FR-013, FR-014).
 */

import * as React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { spacing, theme } from '@/ui/theme';

export function MetadataEditor({
  comments,
  keywords,
  description,
  people,
  goodTake,
  onCommentsChange,
  onKeywordsChange,
  onDescriptionChange,
  onPeopleChange,
  onGoodTakeChange,
}: {
  comments: string;
  keywords: readonly string[];
  description: string;
  people: readonly string[];
  goodTake: boolean;
  onCommentsChange: (value: string) => void;
  onKeywordsChange: (value: string[]) => void;
  onDescriptionChange: (value: string) => void;
  onPeopleChange: (value: string[]) => void;
  onGoodTakeChange: (value: boolean) => void;
}): React.ReactElement {
  return (
    <View style={styles.container}>
      <View style={styles.goodTakeRow}>
        <Text style={styles.goodTakeLabel}>Good take</Text>
        {/* Resolve's Good Take flag. A plain toggle so the whole clip can be
            marked a keeper without opening any marker. */}
        <Pressable
          accessibilityRole="switch"
          accessibilityLabel="Good take"
          accessibilityState={{ checked: goodTake }}
          onPress={() => onGoodTakeChange(!goodTake)}
          style={[styles.toggle, goodTake && styles.toggleOn]}
        >
          <View style={[styles.toggleKnob, goodTake && styles.toggleKnobOn]} />
        </Pressable>
      </View>

      <Text style={styles.label}>Comments</Text>
      <TextInput
        style={styles.comments}
        value={comments}
        onChangeText={onCommentsChange}
        placeholder="Ideas for this clip…"
        placeholderTextColor={theme.textDim}
        multiline
        textAlignVertical="top"
      />

      <Text style={styles.label}>Description</Text>
      <TextInput
        style={styles.comments}
        value={description}
        onChangeText={onDescriptionChange}
        placeholder="A short description — a distinct Resolve field from Comments…"
        placeholderTextColor={theme.textDim}
        multiline
        textAlignVertical="top"
      />

      <Text style={styles.label}>Keywords</Text>
      <TagField
        values={keywords}
        onChange={onKeywordsChange}
        placeholder="Type a keyword…"
        removeLabelPrefix="Remove keyword"
        addLabel="Add keyword"
      />
      <Text style={styles.hint}>
        Tap Add or press Return to add a keyword. Separate several with commas. These
        reach Drive when you tap ✓.
      </Text>

      <Text style={styles.label}>People</Text>
      <TagField
        values={people}
        onChange={onPeopleChange}
        placeholder="Name a person in this clip…"
        removeLabelPrefix="Remove person"
        addLabel="Add person"
      />
    </View>
  );
}

/**
 * A comma-tolerant tag input shared by Keywords and People. Both are lists of
 * short strings that reach Resolve as separate chips, and both had the same
 * invisible-commit problem — so they get the same visible Add button.
 */
function TagField({
  values,
  onChange,
  placeholder,
  removeLabelPrefix,
  addLabel,
}: {
  values: readonly string[];
  onChange: (value: string[]) => void;
  placeholder: string;
  removeLabelPrefix: string;
  addLabel: string;
}): React.ReactElement {
  const [draft, setDraft] = React.useState('');

  const add = (): void => {
    // Split on commas so pasting "a, b, c" does the obvious thing rather than
    // creating one entry with commas in it — which Resolve's CSV import would
    // then re-split into something the user never typed.
    const parts = draft
      .split(',')
      .map((k) => k.trim())
      .filter((k) => k.length > 0);

    if (parts.length === 0) return;
    onChange([...new Set([...values, ...parts])]);
    setDraft('');
  };

  return (
    <>
      <View style={styles.keywordRow}>
        {values.map((k) => (
          <Pressable
            key={k}
            accessibilityRole="button"
            accessibilityLabel={`${removeLabelPrefix} ${k}`}
            style={styles.keyword}
            onPress={() => onChange(values.filter((x) => x !== k))}
          >
            <Text style={styles.keywordLabel}>{k}</Text>
            <Text style={styles.keywordRemove}>×</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.keywordEntry}>
        <TextInput
          style={styles.keywordInput}
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={add}
          onBlur={add}
          placeholder={placeholder}
          placeholderTextColor={theme.textDim}
          returnKeyType="done"
          autoCapitalize="none"
          blurOnSubmit={false}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={addLabel}
          accessibilityState={{ disabled: draft.trim().length === 0 }}
          disabled={draft.trim().length === 0}
          onPress={add}
          style={({ pressed }) => [
            styles.addButton,
            draft.trim().length === 0 && styles.addButtonIdle,
            pressed && styles.addButtonPressed,
          ]}
        >
          <Text style={styles.addButtonLabel}>Add</Text>
        </Pressable>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.sm },
  label: {
    color: theme.textDim,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    marginTop: spacing.md,
  },
  comments: {
    backgroundColor: theme.surface,
    color: theme.text,
    borderRadius: 8,
    padding: spacing.md,
    minHeight: 90,
    fontSize: 15,
  },
  keywordRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  keyword: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: theme.surfaceRaised,
    borderRadius: 14,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
  },
  keywordLabel: { color: theme.text, fontSize: 13 },
  keywordRemove: { color: theme.textDim, fontSize: 15 },
  keywordEntry: { flexDirection: 'row', alignItems: 'stretch', gap: spacing.sm },
  keywordInput: {
    flex: 1,
    backgroundColor: theme.surface,
    color: theme.text,
    borderRadius: 8,
    padding: spacing.md,
    fontSize: 15,
  },
  addButton: {
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderRadius: 8,
    backgroundColor: theme.accent,
  },
  addButtonIdle: { backgroundColor: theme.surfaceRaised },
  addButtonPressed: { opacity: 0.6 },
  addButtonLabel: { color: theme.text, fontSize: 15, fontWeight: '600' },
  hint: { color: theme.textDim, fontSize: 12, lineHeight: 16 },
  goodTakeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.md,
  },
  goodTakeLabel: { color: theme.text, fontSize: 15, fontWeight: '600' },
  toggle: {
    width: 48,
    height: 28,
    borderRadius: 14,
    backgroundColor: theme.surfaceRaised,
    padding: 3,
    justifyContent: 'center',
  },
  toggleOn: { backgroundColor: theme.success },
  toggleKnob: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: theme.text,
    alignSelf: 'flex-start',
  },
  toggleKnobOn: { alignSelf: 'flex-end' },
});
