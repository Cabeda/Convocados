import { alpha, type Theme } from "@mui/material/styles";

/**
 * The few style fragments every tappable on the story cards shares, so a button,
 * a link tile and a stepper all feel the same under a thumb and under a keyboard.
 */
export const NUMERAL_FONT = '"Barlow Condensed", "Arial Narrow", sans-serif';

export const EASE = "cubic-bezier(.2,.8,.2,1)";

const CALM = "@media (prefers-reduced-motion: reduce)";

/** A transition that switches itself off for people who ask for less motion. */
export const motion = (property: string, ms = 280) => ({
  transition: `${property} ${ms}ms ${EASE}`,
  [CALM]: { transition: "none" },
});

/** Press feedback: a 2% squeeze for 80ms. Instant for people who ask for less motion. */
export const pressable = {
  transition: "transform 80ms ease, opacity 80ms ease",
  "&:active": { transform: "scale(.98)", opacity: 0.85 },
  [CALM]: { transition: "none", "&:active": { transform: "none" } },
};

/** Keyboard focus: a 2px primary ring, 2px off the edge. Never shown for a tap. */
export const focusRing = {
  "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: "2px" },
};

/** Everything tappable on the story cards. */
export const tappable = { ...pressable, ...focusRing };

/** The height of a primary action: 48px, 56px for the one that finishes a panel. */
export const ACTION_HEIGHT = 48;
export const PANEL_ACTION_HEIGHT = 56;

/** The scoreboard, steppers and panels sit together on a wide screen instead of stretching. */
export const BOARD_MAX_WIDTH = "28rem";

/** One quiet buzz when something is done. Not every device has a vibration motor. */
export const cheer = () => {
  try { navigator.vibrate?.(10); } catch { /* not supported */ }
};

/** An icon button on the event header: a 44px target with press feedback and a focus ring. */
export const iconAction = { width: 44, height: 44, color: "text.primary", ...tappable };

/** Grows the tap area of an inline link to about 44px without moving any text. */
export const hitArea = {
  position: "relative",
  "&::after": { content: '""', position: "absolute", inset: "-10px -6px" },
} as const;

/** A small labelled action in the quiet row under the info lines: the words are visible, 44px tall. */
export const textAction = {
  minHeight: 44, px: 1.25, gap: 0.75, borderRadius: 999, textTransform: "none", fontSize: "1rem", fontWeight: 600,
  color: "text.secondary", ...tappable,
} as const;

/**
 * The outline of a control (an open spot's ring, "Add a friend", a chip) must show at 3:1 against the page
 * (WCAG 1.4.11). The theme's `divider` is a hairline for separators and reads at about 1.7:1, so it is not
 * used for these; this is the page's secondary text colour, a little softened.
 */
export const controlBorder = (theme: Theme) => alpha(theme.palette.text.secondary, 0.75);

/** Read by a screen reader, never seen: the live region for what other people just did. */
export const srOnly = {
  position: "absolute", width: 1, height: 1, p: 0, m: -1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap", border: 0,
} as const;
