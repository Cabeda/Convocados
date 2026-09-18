import { useState } from "react";
import {
  Box, Button, Chip, Paper, Slider, Stack, ToggleButton, ToggleButtonGroup, Typography,
} from "@mui/material";
import { expectedScore } from "~/lib/elo";

export interface RankMathDemoProps {
  /** Your current rating. Defaults to the Convocados case (1720). */
  yourRating?: number;
  /** Opponents' average rating. Defaults to 1000. */
  opponentAvg?: number;
  /** K-factor, the maximum a single game can move the rating. Defaults to 32. */
  k?: number;
  /** Actual score: 1 win, 0.5 draw, 0 loss. Defaults to 1. */
  outcome?: 1 | 0.5 | 0;
}

const OUTCOME_OPTIONS: { value: 1 | 0.5 | 0; label: string }[] = [
  { value: 1, label: "Win" },
  { value: 0.5, label: "Draw" },
  { value: 0, label: "Loss" },
];

function num(value: number | number[]): number {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Lesson 1 — the Elo expected score and the update rule, made tangible.
 * Shows E, the raw rating change, and what a win rounds to "on the board".
 */
export function RankMathDemo({
  yourRating = 1720,
  opponentAvg = 1000,
  k = 32,
  outcome = 1,
}: RankMathDemoProps) {
  const [you, setYou] = useState(yourRating);
  const [opp, setOpp] = useState(opponentAvg);
  const [kFactor, setKFactor] = useState(k);
  const [result, setResult] = useState<1 | 0.5 | 0>(outcome);

  const expected = expectedScore(you, opp);
  const delta = kFactor * (result - expected);
  const board = Math.round(delta);
  const deltaColor = delta > 0.05 ? "success.main" : delta < -0.05 ? "error.main" : "text.secondary";

  const applyPreset = (y: number, o: number, kk: number, s: 1 | 0.5 | 0) => {
    setYou(y);
    setOpp(o);
    setKFactor(kk);
    setResult(s);
  };

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 2.5 }, borderRadius: 2, my: 2 }}>
      <Typography variant="h6" fontWeight={700} gutterBottom>
        Try it — the Convocados case
      </Typography>

      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 2 }}>
        <Box>
          <Typography variant="overline" color="text.secondary">
            Your rating · {you}
          </Typography>
          <Slider
            value={you}
            min={800}
            max={2200}
            step={10}
            size="small"
            onChange={(_, v) => setYou(num(v))}
            aria-label="Your rating"
          />
        </Box>
        <Box>
          <Typography variant="overline" color="text.secondary">
            Opponent average · {opp}
          </Typography>
          <Slider
            value={opp}
            min={800}
            max={2200}
            step={10}
            size="small"
            onChange={(_, v) => setOpp(num(v))}
            aria-label="Opponent average rating"
          />
        </Box>
        <Box>
          <Typography variant="overline" color="text.secondary">
            K-factor · {kFactor}
          </Typography>
          <Slider
            value={kFactor}
            min={8}
            max={96}
            step={8}
            size="small"
            onChange={(_, v) => setKFactor(num(v))}
            aria-label="K-factor"
          />
        </Box>
        <Box>
          <Typography variant="overline" color="text.secondary">
            Your result
          </Typography>
          <ToggleButtonGroup
            exclusive
            fullWidth
            size="small"
            value={result}
            onChange={(_, v: 1 | 0.5 | 0 | null) => v !== null && setResult(v)}
            aria-label="Your result"
          >
            {OUTCOME_OPTIONS.map((o) => (
              <ToggleButton key={o.label} value={o.value} sx={{ textTransform: "none" }}>
                {o.label}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        </Box>
      </Box>

      <Stack
        spacing={1}
        sx={{
          mt: 2, pt: 2, borderTop: "1px dashed", borderColor: "divider",
          fontFamily: "ui-monospace, monospace",
        }}
      >
        <Typography variant="body2" sx={{ fontFamily: "inherit" }}>
          Expected score E = <strong>{expected.toFixed(3)}</strong>
        </Typography>
        <Typography variant="body2" sx={{ fontFamily: "inherit" }}>
          Rating change ={" "}
          <Box component="strong" sx={{ color: deltaColor }}>
            {delta >= 0 ? "+" : ""}
            {delta.toFixed(1)}
          </Box>{" "}
          <Box component="span" sx={{ color: "text.secondary" }}>
            ({board >= 0 ? "+" : ""}
            {board} on the board)
          </Box>
        </Typography>
      </Stack>

      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1.5 }}>
        <Chip
          size="small"
          variant="outlined"
          label="even game"
          onClick={() => applyPreset(1500, 1500, 32, 1)}
        />
        <Chip
          size="small"
          variant="outlined"
          label="strong vs weak"
          onClick={() => applyPreset(1720, 1000, 32, 1)}
        />
        <Chip
          size="small"
          variant="outlined"
          label="provisional (K=64)"
          onClick={() => applyPreset(1720, 1000, 64, 1)}
        />
      </Stack>

      {result === 1 && board === 0 && (
        <Box
          sx={{
            mt: 2, p: 1.5, borderRadius: 1.5,
            bgcolor: "action.hover", borderLeft: "3px solid", borderColor: "warning.main",
          }}
        >
          <Typography variant="body2">
            <strong>Why "won twice, gained nothing" happens.</strong> E ≈ {expected.toFixed(3)}; a win is
            worth only K·(1 − E), which rounds to 0 on the board. The maths is correct — the payout
            design fails the player.
          </Typography>
        </Box>
      )}

      <Box sx={{ mt: 1.5 }}>
        <Button size="small" onClick={() => applyPreset(1720, 1000, 32, 1)}>
          Reset to Convocados case
        </Button>
      </Box>
    </Paper>
  );
}

export default RankMathDemo;
