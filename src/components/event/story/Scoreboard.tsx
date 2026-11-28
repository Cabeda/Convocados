import "@fontsource/barlow-condensed/latin-600.css";
import "@fontsource/barlow-condensed/latin-700.css";
import { Box, Typography } from "@mui/material";

/** Condensed numerals: used for the scoreboard only (and later the date). Body text keeps the theme font. */
export const NUMERAL_FONT = '"Barlow Condensed", "Arial Narrow", sans-serif';

export const EASE = "cubic-bezier(.2,.8,.2,1)";
/** A transition that switches itself off for people who ask for less motion. */
export const motion = (property: string, ms = 280) => ({
  transition: `${property} ${ms}ms ${EASE}`,
  "@media (prefers-reduced-motion: reduce)": { transition: "none" },
});

export interface ScoreboardProps {
  teamOneName: string;
  teamTwoName: string;
  scoreOne: number | null;
  scoreTwo: number | null;
  /** The strip form: the same scoreboard, smaller. */
  compact: boolean;
  /** Roll the digits to a new value (only after the viewer saved a score). */
  rollOnChange?: boolean;
}

/** A numeral whose digits roll in when it changes after a user action. */
function Numeral({ testId, value, color, compact, roll }: {
  testId: string; value: number | null; color: string; compact: boolean; roll: boolean;
}) {
  return (
    <Typography
      component="span"
      data-testid={testId}
      sx={{
        display: "block", overflow: "hidden", color,
        fontFamily: NUMERAL_FONT, fontWeight: 700, lineHeight: 0.95, fontVariantNumeric: "tabular-nums",
        fontSize: compact ? "1.875rem" : "clamp(4rem, 22vw, 5.5rem)",
        ...motion("font-size"),
      }}
    >
      <Box
        component="span"
        key={roll ? String(value) : "static"}
        sx={roll ? {
          display: "inline-block",
          animation: `scoreRoll 250ms ${EASE}`,
          "@keyframes scoreRoll": { from: { transform: "translateY(0.4em)", opacity: 0 }, to: { transform: "none", opacity: 1 } },
          "@media (prefers-reduced-motion: reduce)": { animation: "none" },
        } : { display: "inline-block" }}
      >
        {value ?? "–"}
      </Box>
    </Typography>
  );
}

/**
 * The one memorable thing on the page: big tabular numerals, winner in the
 * primary colour, loser quieter. The strip is this same element resized, so
 * expanding and collapsing never swaps it out.
 */
export function Scoreboard({ teamOneName, teamTwoName, scoreOne, scoreTwo, compact, rollOnChange = false }: ScoreboardProps) {
  const missing = scoreOne === null || scoreTwo === null;
  const a = scoreOne ?? 0;
  const b = scoreTwo ?? 0;
  const colour = (wins: boolean) => (!missing && wins ? "primary.main" : "text.secondary");
  const nameSx = (winner: boolean) => ({
    fontSize: compact ? "0.875rem" : "1rem", fontWeight: winner ? 700 : 400, lineHeight: 1.25,
    overflowWrap: "break-word", textWrap: "balance", color: "text.primary", ...motion("font-size"),
  });

  return (
    <Box sx={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "end", columnGap: 1.5 }}>
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={nameSx(!missing && a >= b)}>{teamOneName}</Typography>
        <Numeral testId="score-one" value={scoreOne} color={colour(a >= b)} compact={compact} roll={rollOnChange} />
      </Box>
      <Typography aria-hidden sx={{ fontFamily: NUMERAL_FONT, fontSize: compact ? "1.25rem" : "3rem", lineHeight: 0.95, color: "text.secondary", pb: compact ? 0.25 : 0.5, ...motion("font-size") }}>–</Typography>
      <Box sx={{ minWidth: 0, textAlign: "right" }}>
        <Typography sx={nameSx(!missing && b >= a)}>{teamTwoName}</Typography>
        <Numeral testId="score-two" value={scoreTwo} color={colour(b >= a)} compact={compact} roll={rollOnChange} />
      </Box>
    </Box>
  );
}
