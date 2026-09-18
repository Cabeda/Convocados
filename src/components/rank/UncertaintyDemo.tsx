import { useMemo, useState } from "react";
import { Box, Paper, Slider, Stack, Typography } from "@mui/material";

export interface UncertaintyDemoProps {
  /** Games played against the reference opponent. Defaults to 0 (unproven). */
  gamesPlayed?: number;
  /** Current rating. Defaults to 1500. */
  yourRating?: number;
  /** Starting rating deviation. Defaults to 350 (wide). */
  startingRd?: number;
  /** Reference opponent's rating. Defaults to 1500. */
  opponentRating?: number;
  /** Reference opponent's own rating deviation. Defaults to 50. */
  opponentRd?: number;
}

const Q = Math.LN10 / 400;
const WIN_LO = 1000;
const WIN_HI = 2000;

function g(rd: number): number {
  return 1 / Math.sqrt(1 + (3 * Q * Q * rd * rd) / (Math.PI * Math.PI));
}

function expectedGlicko(r: number, rj: number, rdj: number): number {
  return 1 / (1 + Math.pow(10, (-g(rdj) * (r - rj)) / 400));
}

/** One original-Glicko update (Glickman 1995) against a single opponent. */
function update(
  r: number, rd: number, rj: number, rdj: number, s: number,
): { r: number; rd: number; delta: number } {
  const gj = g(rdj);
  const e = expectedGlicko(r, rj, rdj);
  const d2 = 1 / (Q * Q * gj * gj * e * (1 - e));
  const denom = 1 / (rd * rd) + 1 / d2;
  const rNew = r + (Q / denom) * gj * (s - e);
  const rdNew = Math.sqrt(1 / denom);
  return { r: rNew, rd: rdNew, delta: rNew - r };
}

function num(value: number | number[]): number {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Lesson 2 — the cost of certainty. Glicko's rating deviation (RD) makes the
 * error bar visible: same rating, different confidence, and a next win that
 * moves further while evidence is thin.
 */
export function UncertaintyDemo({
  gamesPlayed = 0,
  yourRating = 1500,
  startingRd = 350,
  opponentRating = 1500,
  opponentRd = 50,
}: UncertaintyDemoProps) {
  const [games, setGames] = useState(gamesPlayed);
  const [rating, setRating] = useState(yourRating);

  const { rd, move } = useMemo(() => {
    let r = rating;
    let dev = startingRd;
    for (let i = 0; i < games; i++) {
      const u = update(r, dev, opponentRating, opponentRd, 1);
      r = u.r;
      dev = u.rd;
    }
    const next = update(rating, dev, opponentRating, opponentRd, 1);
    return { rd: dev, move: next.delta };
  }, [games, rating, startingRd, opponentRating, opponentRd]);

  const lo = rating - 2 * rd;
  const hi = rating + 2 * rd;
  const pct = (v: number) => Math.max(0, Math.min(100, ((v - WIN_LO) / (WIN_HI - WIN_LO)) * 100));
  const ciLeft = pct(lo);
  const ciWidth = Math.max(1, pct(hi) - ciLeft);

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 2.5 }, borderRadius: 2, my: 2 }}>
      <Typography variant="h6" fontWeight={700} gutterBottom>
        Same rating, different confidence
      </Typography>

      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 2 }}>
        <Box>
          <Typography variant="overline" color="text.secondary">
            Games played · {games}
          </Typography>
          <Slider
            value={games}
            min={0}
            max={60}
            step={1}
            size="small"
            onChange={(_, v) => setGames(num(v))}
            aria-label="Games played"
          />
        </Box>
        <Box>
          <Typography variant="overline" color="text.secondary">
            Current rating · {rating}
          </Typography>
          <Slider
            value={rating}
            min={800}
            max={2200}
            step={10}
            size="small"
            onChange={(_, v) => setRating(num(v))}
            aria-label="Current rating"
          />
        </Box>
      </Box>

      <Box sx={{ position: "relative", height: 44, mt: 2 }}>
        <Box sx={{ position: "absolute", left: 0, right: 0, top: 22, borderTop: "1px solid", borderColor: "divider" }} />
        <Box
          sx={{
            position: "absolute", top: 14, height: 14, borderRadius: 1,
            bgcolor: "primary.main", opacity: 0.18,
            border: "1px solid", borderColor: "primary.main",
            left: `${ciLeft}%`, width: `${ciWidth}%`,
          }}
        />
        <Box sx={{ position: "absolute", top: 10, width: 2, height: 24, bgcolor: "primary.main", left: `${pct(rating)}%` }} />
        <Typography
          variant="caption"
          sx={{ position: "absolute", top: 28, left: `${ciLeft}%`, transform: "translateX(-50%)", fontFamily: "ui-monospace, monospace" }}
        >
          {Math.round(lo)}
        </Typography>
        <Typography
          variant="caption"
          sx={{ position: "absolute", top: 28, left: `${pct(hi)}%`, transform: "translateX(-50%)", fontFamily: "ui-monospace, monospace" }}
        >
          {Math.round(hi)}
        </Typography>
      </Box>

      <Stack spacing={1} sx={{ mt: 1, pt: 2, borderTop: "1px dashed", borderColor: "divider" }}>
        <Typography variant="body2" sx={{ fontFamily: "ui-monospace, monospace" }}>
          Rating deviation RD = <strong>{rd.toFixed(0)}</strong>{" "}
          <Box component="span" sx={{ color: "text.secondary" }}>
            (95% confidence: {Math.round(lo)} – {Math.round(hi)})
          </Box>
        </Typography>
        <Typography variant="body2" sx={{ fontFamily: "ui-monospace, monospace" }}>
          Next win moves you: <strong>+{Math.max(0, move).toFixed(1)} pts</strong>{" "}
          <Box component="span" sx={{ color: "text.secondary" }}>
            (beating an equal {opponentRating})
          </Box>
        </Typography>
      </Stack>

      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
        Starting RD is 350 (wide). Consistent results shrink it; each 95% range should feel visibly
        narrower. RD grows again during inactivity, because a rating frozen for a year is stale
        evidence.
      </Typography>
    </Paper>
  );
}

export default UncertaintyDemo;
