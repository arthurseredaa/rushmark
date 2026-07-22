import * as React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native';

import { spacing, theme } from './theme';

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  busy = false,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  busy?: boolean;
}): React.ReactElement {
  const background =
    variant === 'primary' ? theme.accent : variant === 'danger' ? theme.danger : theme.surfaceRaised;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: background, opacity: disabled ? 0.4 : pressed ? 0.7 : 1 },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={theme.text} />
      ) : (
        <Text style={styles.buttonLabel}>{label}</Text>
      )}
    </Pressable>
  );
}

/** A banner that informs without blocking — used for parse warnings (FR-023a). */
export function Banner({
  tone,
  title,
  detail,
}: {
  tone: 'warning' | 'info' | 'danger';
  title: string;
  detail?: string;
}): React.ReactElement {
  const color =
    tone === 'warning' ? theme.warning : tone === 'danger' ? theme.danger : theme.accent;

  return (
    <View style={[styles.banner, { borderLeftColor: color }]}>
      <Text style={[styles.bannerTitle, { color }]}>{title}</Text>
      {detail ? <Text style={styles.bannerDetail}>{detail}</Text> : null}
    </View>
  );
}

export function Empty({
  title,
  detail,
}: {
  title: string;
  detail?: string;
}): React.ReactElement {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      {detail ? <Text style={styles.emptyDetail}>{detail}</Text> : null}
    </View>
  );
}

export function Loading({ label }: { label?: string }): React.ReactElement {
  return (
    <View style={styles.empty}>
      <ActivityIndicator color={theme.textDim} />
      {label ? <Text style={styles.emptyDetail}>{label}</Text> : null}
    </View>
  );
}

export function Badge({
  label,
  color = theme.textDim,
  style,
}: {
  label: string;
  color?: string;
  style?: ViewStyle;
}): React.ReactElement {
  return (
    <View style={[styles.badge, { borderColor: color }, style]}>
      <Text style={[styles.badgeLabel, { color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  buttonLabel: { color: theme.text, fontSize: 16, fontWeight: '600' },
  banner: {
    backgroundColor: theme.surface,
    borderLeftWidth: 3,
    padding: spacing.md,
    borderRadius: 6,
    marginBottom: spacing.md,
  },
  bannerTitle: { fontSize: 14, fontWeight: '600' },
  bannerDetail: { color: theme.textDim, fontSize: 13, marginTop: spacing.xs, lineHeight: 18 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  emptyTitle: { color: theme.text, fontSize: 17, fontWeight: '600', textAlign: 'center' },
  emptyDetail: {
    color: theme.textDim,
    fontSize: 14,
    textAlign: 'center',
    marginTop: spacing.sm,
    lineHeight: 20,
  },
  badge: {
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: spacing.xs + 2,
    paddingVertical: 2,
  },
  badgeLabel: { fontSize: 11, fontWeight: '600' },
});
