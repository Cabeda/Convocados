/**
 * Watch PWA theme tokens — M3-inspired, dark-only (OLED-friendly).
 *
 * Designed for round and square smartwatches:
 * - High contrast on dark backgrounds
 * - Large touch targets (≥48px)
 * - Safe area insets for round displays
 * - Tonal surface hierarchy from the main app's green palette
 */

export const t = {
  // Surfaces (dark, tonal hierarchy)
  surface: "#111412",
  surfaceContainer: "#1a1d1b",
  surfaceContainerHigh: "#242724",
  surfaceContainerHighest: "#2e312e",

  // Primary (green from main app)
  primary: "#7edcab",
  primaryContainer: "#1b6b4a",
  onPrimary: "#003822",
  onPrimaryContainer: "#a8ecc8",

  // Secondary
  secondary: "#b2ccbf",
  secondaryContainer: "#3a5347",
  onSecondaryContainer: "#cee8da",

  // Error
  error: "#ffb4ab",
  errorContainer: "#93000a",
  onErrorContainer: "#ffdad6",

  // Warning / amber
  warning: "#f5bf48",
  warningContainer: "#5c4300",

  // Text
  onSurface: "#e1e3de",
  onSurfaceVariant: "#c2c9c1",
  outline: "#8c9389",
  outlineVariant: "#3a3f3b",

  // Misc
  scrim: "rgba(0,0,0,0.6)",
  shadow: "rgba(0,0,0,0.3)",
} as const;

/** Shared style helpers for watch components */
export const watchBase: React.CSSProperties = {
  background: t.surface,
  color: t.onSurface,
  minHeight: "100vh",
  fontFamily: "-apple-system, 'SF Pro Rounded', 'Roboto', sans-serif",
  fontSize: "clamp(12px, 7vw, 14px)",
  WebkitFontSmoothing: "antialiased",
  // Safe area for round watches — content stays inside the inscribed square
  padding: "env(safe-area-inset-top, clamp(4px, 3vw, 8px)) env(safe-area-inset-right, clamp(4px, 3vw, 8px)) env(safe-area-inset-bottom, clamp(4px, 3vw, 8px)) env(safe-area-inset-left, clamp(4px, 3vw, 8px))",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
};

/**
 * Minimum touch target — scales from 36px on tiny watches to 48px on normal ones.
 * Uses clamp() so CSS handles the scaling; the constant is kept for non-CSS contexts.
 */
export const TAP_MIN = 48;
export const TAP_MIN_CSS = "clamp(36px, 25vw, 48px)";

/** Pill-shaped button base */
export const pillBtn: React.CSSProperties = {
  minWidth: TAP_MIN_CSS,
  minHeight: TAP_MIN_CSS,
  border: "none",
  borderRadius: 9999,
  fontWeight: 700,
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  transition: "background 0.15s, transform 0.1s",
  WebkitTapHighlightColor: "transparent",
  userSelect: "none",
};

/** Tonal filled button (primary container) */
export const tonalBtn: React.CSSProperties = {
  ...pillBtn,
  background: t.primaryContainer,
  color: t.onPrimaryContainer,
};

/** Surface-variant button (score +/-) */
export const surfaceBtn: React.CSSProperties = {
  ...pillBtn,
  background: t.surfaceContainerHigh,
  color: t.onSurface,
};

/** Card / list-item surface */
export const card: React.CSSProperties = {
  background: t.surfaceContainer,
  borderRadius: 16,
  padding: "clamp(6px, 4vw, 12px) clamp(8px, 5vw, 16px)",
  width: "100%",
  maxWidth: "min(220px, 90vw)",
  textDecoration: "none",
  color: t.onSurface,
  display: "flex",
  flexDirection: "column",
  gap: "clamp(2px, 1vw, 4px)",
  border: `1px solid ${t.outlineVariant}`,
  transition: "border-color 0.15s",
};
