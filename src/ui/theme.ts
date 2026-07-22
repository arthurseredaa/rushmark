import type { MarkerColor } from '@/domain/canonical';

/** Dark by default: this is a video tool, and a bright chrome fights the footage. */
export const theme = {
  bg: '#111111',
  surface: '#1c1c1e',
  surfaceRaised: '#2c2c2e',
  border: '#38383a',
  text: '#ffffff',
  textDim: '#9a9a9e',
  accent: '#0a84ff',
  danger: '#ff453a',
  success: '#32d74b',
  warning: '#ff9f0a',
} as const;

/** The marker palette, as Resolve renders it. Only RED/GREEN/BLUE are spike-verified. */
export const MARKER_SWATCH: Record<MarkerColor, string> = {
  RED: '#ff453a',
  GREEN: '#32d74b',
  BLUE: '#0a84ff',
  CYAN: '#64d2ff',
  YELLOW: '#ffd60a',
  PINK: '#ff6482',
  PURPLE: '#bf5af2',
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;
