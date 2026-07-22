/**
 * Whole-video comments and keywords (FR-013, FR-014).
 */

import * as React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { spacing, theme } from '@/ui/theme';

export function MetadataEditor({
  comments,
  keywords,
  onCommentsChange,
  onKeywordsChange,
}: {
  comments: string;
  keywords: readonly string[];
  onCommentsChange: (value: string) => void;
  onKeywordsChange: (value: string[]) => void;
}): React.ReactElement {
  const [draft, setDraft] = React.useState('');

  const addKeyword = (): void => {
    // Split on commas so pasting "a, b, c" does the obvious thing rather than
    // creating one keyword with commas in it — which would then be re-split by
    // Resolve's CSV import into something the user never typed.
    const parts = draft
      .split(',')
      .map((k) => k.trim())
      .filter((k) => k.length > 0);

    if (parts.length === 0) return;
    const next = [...new Set([...keywords, ...parts])];
    onKeywordsChange(next);
    setDraft('');
  };

  return (
    <View style={styles.container}>
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

      <Text style={styles.label}>Keywords</Text>
      <View style={styles.keywordRow}>
        {keywords.map((k) => (
          <Pressable
            key={k}
            accessibilityRole="button"
            accessibilityLabel={`Remove keyword ${k}`}
            style={styles.keyword}
            onPress={() => onKeywordsChange(keywords.filter((x) => x !== k))}
          >
            <Text style={styles.keywordLabel}>{k}</Text>
            <Text style={styles.keywordRemove}>×</Text>
          </Pressable>
        ))}
      </View>
      <TextInput
        style={styles.keywordInput}
        value={draft}
        onChangeText={setDraft}
        onSubmitEditing={addKeyword}
        onBlur={addKeyword}
        placeholder="Add a keyword, or several separated by commas"
        placeholderTextColor={theme.textDim}
        returnKeyType="done"
        autoCapitalize="none"
      />
    </View>
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
  keywordInput: {
    backgroundColor: theme.surface,
    color: theme.text,
    borderRadius: 8,
    padding: spacing.md,
    fontSize: 15,
  },
});
