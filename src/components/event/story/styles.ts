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
