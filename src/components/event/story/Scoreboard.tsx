import "@fontsource/barlow-condensed/latin-600.css";
import "@fontsource/barlow-condensed/latin-700.css";
import { useState } from "react";
import { Box, Typography } from "@mui/material";
import { BOARD_MAX_WIDTH, EASE, NUMERAL_FONT } from "./styles";

// Kept for the components that import them from here.
export { EASE, NUMERAL_FONT, motion } from "./styles";

/** The big and the small numeral size; the strip is the same element at the small one. */
const BIG = 5;
const SMALL = 1.875;
const SHRINK = BIG / SMALL;

export interface ScoreboardProps {
  teamOneName: string;
  teamTwoName: string;
  scoreOne: number | null;
  scoreTwo: number | null;
  /** The strip form: one line, the same scoreboard at the small size. */
  compact: boolean;
  /** Roll the digits to a new value (only after the viewer saved a score). */
  rollOnChange?: boolean;
}

const CALM = "@media (prefers-reduced-motion: reduce)";

/**
 * A numeral. Its size changes in one step and a transform animation (never a
 * font-size transition, which re-lays the glyphs every frame) glides it from the
 * old size to the new one, so the strip and the card are the same element.
 */
function Numeral({ testId, value, color, compact, animate, roll, align }: {
  testId: string; value: number | null; color: string; compact: boolean; animate: boolean; roll: boolean; align: "left" | "right";
}) {
  const name = compact ? "recapNumeralShrink" : "recapNumeralGrow";
  return (
    <Typography
      component="span"
      data-testid={testId}
      sx={{
        display: "block", color, whiteSpace: "nowrap",
        fontFamily: NUMERAL_FONT, fontWeight: 700, lineHeight: 0.95, fontVariantNumeric: "tabular-nums",
        fontSize: `${compact ? SMALL : BIG}rem`,
        transformOrigin: `${align} bottom`,
        ...(animate ? {
          animation: `${name} 280ms ${EASE}`,
          "@keyframes recapNumeralShrink": { from: { transform: `scale(${SHRINK})` }, to: { transform: "scale(1)" } },
          "@keyframes recapNumeralGrow": { from: { transform: `scale(${1 / SHRINK})` }, to: { transform: "scale(1)" } },
          [CALM]: { animation: "none" },
        } : {}),
      }}
    >
      <Box
        component="span"
        key={roll ? String(value) : "static"}
        sx={roll ? {
          display: "inline-block",
          animation: `scoreRoll 250ms ${EASE}`,
          "@keyframes scoreRoll": { from: { transform: "translateY(0.4em)", opacity: 0 }, to: { transform: "none", opacity: 1 } },
          [CALM]: { animation: "none" },
        } : { display: "inline-block" }}
      >
        {value ?? "–"}
      </Box>
    </Typography>
  );
}

/**
 * The one memorable thing on the page: big tabular numerals, winner in the
 * primary colour, loser quieter. It is capped to a narrow column so the two
 * numbers sit together on a wide screen. The strip is this same element at a
 * smaller size on one line, so expanding and collapsing never swaps it out.
 */
export function Scoreboard({ teamOneName, teamTwoName, scoreOne, scoreTwo, compact, rollOnChange = false }: ScoreboardProps) {
  const missing = scoreOne === null || scoreTwo === null;
  const a = scoreOne ?? 0;
  const b = scoreTwo ?? 0;
  const colour = (wins: boolean) => (!missing && wins ? "primary.main" : "text.secondary");
  // Only animate a size change the viewer caused, never the first paint.
  const [seenCompact, setSeenCompact] = useState(compact);
  const [animate, setAnimate] = useState(false);
  if (seenCompact !== compact) { setSeenCompact(compact); setAnimate(true); }

  const nameSx = (winner: boolean, area: string, align: "left" | "right") => ({
    gridArea: area, fontSize: compact ? "0.9375rem" : "1rem", fontWeight: winner ? 700 : 400, lineHeight: 1.25,
    overflowWrap: "break-word", textWrap: "balance", color: "text.primary", minWidth: 0,
    textAlign: compact ? "left" : align, alignSelf: compact ? "center" : "end",
  });

  return (
    <Box
      sx={{
        display: "grid", columnGap: compact ? 1 : 1.5, rowGap: 0, maxWidth: BOARD_MAX_WIDTH, mx: "auto", width: "100%",
        gridTemplateColumns: compact ? "minmax(0, auto) auto auto auto minmax(0, 1fr)" : "1fr auto 1fr",
        gridTemplateAreas: compact ? '"n1 s1 d s2 n2"' : '"n1 . n2" "s1 d s2"',
        alignItems: "end",
      }}
    >
      <Typography sx={nameSx(!missing && a >= b, "n1", "left")}>{teamOneName}</Typography>
      <Box sx={{ gridArea: "s1", minWidth: 0 }}>
        <Numeral testId="score-one" value={scoreOne} color={colour(a >= b)} compact={compact} animate={animate} roll={rollOnChange} align="left" />
      </Box>
      <Typography
        aria-hidden
        sx={{ gridArea: "d", fontFamily: NUMERAL_FONT, fontSize: compact ? "1.25rem" : "3rem", lineHeight: 0.95, color: "text.secondary", pb: compact ? 0.25 : 0.5 }}
      >–</Typography>
      <Box sx={{ gridArea: "s2", minWidth: 0, textAlign: compact ? "left" : "right" }}>
        <Numeral testId="score-two" value={scoreTwo} color={colour(b >= a)} compact={compact} animate={animate} roll={rollOnChange} align={compact ? "left" : "right"} />
      </Box>
      <Typography sx={nameSx(!missing && b >= a, "n2", "right")}>{teamTwoName}</Typography>
    </Box>
  );
}
