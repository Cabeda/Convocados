import { useState } from "react";
import {
  Box, Chip, Paper, Slider, Stack, ToggleButton, ToggleButtonGroup, Typography,
} from "@mui/material";
import { expectedScore } from "~/lib/elo";
import { EXPECTED_CLAMP, RANK_POINT_SCALE, clampExpected } from "~/lib/seasonRank";

export interface PayoutDemoProps {
  /** Your rating. Defaults to the Convocados case (1720). */
  yourRating?: number;
  /** Opponents' average rating. Defaults to 1000. */
  opponentAvg?: number;
  /** K-factor. Defaults to 32. */
  k?: number;
  /** Expected-score clamp cap, e.g. 0.9. Use 0.999 for "none". Defaults to 0.9. */
  clamp?: number;
  /** Unit scale: 1 for Elo points, 10 for Rank Points. Defaults to 1. */
  scale?: number;
}

const CLAMP_OPTIONS: { value: number; label: string }[] = [
  { value: 0.999, label: "none" },
  { value: 0.95, label: "0.95" },
  { value: 0.9, label: "0.90" },
  { value: 0.8, label: "0.80" },
];

function num(value: number | number[]): number {
  return Array.isArray(value) ? value[0] : value;
}

function signed(value: number): string {
  return (value > 0 ? "+" : "") + value;
}

/**
 * Lesson 3 — pricing a win. The three levers (clamp E, change K, change the
 * unit) and what each does to the win/draw/loss payout.
 */
export function PayoutDemo({
  yourRating = 1720,
  opponentAvg = 1000,
  k = 32,
  clamp = EXPECTED_CLAMP,
  scale = 1,
}: PayoutDemoProps) {
  const [you, setYou] = useState(yourRating);
  const [opp, setOpp] = useState(opponentAvg);
  const [kFactor, setKFactor] = useState(k);
  const [cap, setCap] = useState(clamp);
  const [unit, setUnit] = useState(scale);

  const raw = expectedScore(you, opp);
  const eff = clampExpected(raw, cap);
  const payout = (s: number) => Math.round(kFactor * (s - eff) * unit);

  const cells = [
    { label: "Win", value: payout(1) },
    { label: "Draw", value: payout(0.5) },
    { label: "Loss", value: payout(0) },
  ];

  const applyPreset = (y: number, o: number, kk: number, c: number, sc: number) => {
    setYou(y);
    setOpp(o);
    setKFactor(kk);
    setCap(c);
    setUnit(sc);
  };

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 2.5 }, borderRadius: 2, my: 2 }}>
      <Typography variant="h6" fontWeight={700} gutterBottom>
        Design a payout
      </Typography>

      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 2 }}>
        <Box>
          <Typography variant="overline" color="text.secondary">
            Your rating · {you}
          </Typography>
          <Slider value={you} min={800} max={2200} step={10} size="small" onChange={(_, v) => setYou(num(v))} aria-label="Your rating" />
        </Box>
        <Box>
          <Typography variant="overline" color="text.secondary">
            Opponent average · {opp}
          </Typography>
          <Slider value={opp} min={800} max={2200} step={10} size="small" onChange={(_, v) => setOpp(num(v))} aria-label="Opponent average" />
        </Box>
        <Box>
          <Typography variant="overline" color="text.secondary">
            K-factor · {kFactor}
          </Typography>
          <Slider value={kFactor} min={8} max={96} step={8} size="small" onChange={(_, v) => setKFactor(num(v))} aria-label="K-factor" />
        </Box>
        <Box>
          <Typography variant="overline" color="text.secondary">
            Expected-score clamp
          </Typography>
          <ToggleButtonGroup
            exclusive
            fullWidth
            size="small"
            value={cap}
            onChange={(_, v: number | null) => v !== null && setCap(v)}
            aria-label="Expected-score clamp"
          >
            {CLAMP_OPTIONS.map((c) => (
              <ToggleButton key={c.label} value={c.value} sx={{ textTransform: "none" }}>
                {c.label}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        </Box>
        <Box>
          <Typography variant="overline" color="text.secondary">
            Unit scale
          </Typography>
          <ToggleButtonGroup
            exclusive
            fullWidth
            size="small"
            value={unit}
            onChange={(_, v: number | null) => v !== null && setUnit(v)}
            aria-label="Unit scale"
          >
            <ToggleButton value={1} sx={{ textTransform: "none" }}>
              ×1
            </ToggleButton>
            <ToggleButton value={RANK_POINT_SCALE} sx={{ textTransform: "none" }}>
              ×{RANK_POINT_SCALE} (RP)
            </ToggleButton>
          </ToggleButtonGroup>
        </Box>
      </Box>

      <Typography variant="body2" sx={{ mt: 2, fontFamily: "ui-monospace, monospace" }}>
        Raw E = <strong>{raw.toFixed(3)}</strong>, clamped E = <strong>{eff.toFixed(3)}</strong>
      </Typography>

      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 1, mt: 1.5 }}>
        {cells.map((cell) => {
          const isZero = cell.value === 0;
          return (
            <Box
              key={cell.label}
              sx={{
                border: "1px solid", borderColor: "divider", borderRadius: 1.5,
                p: 1, textAlign: "center",
              }}
            >
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", textTransform: "uppercase", letterSpacing: ".06em" }}>
                {cell.label}
              </Typography>
              <Typography
                variant="h6"
                sx={{
                  fontFamily: "ui-monospace, monospace",
                  color: isZero ? "error.main" : cell.value > 0 ? "success.main" : "text.secondary",
                }}
              >
                {signed(cell.value)}
              </Typography>
            </Box>
          );
        })}
      </Box>

      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1.5 }}>
        <Chip size="small" variant="outlined" label="current Convocados" onClick={() => applyPreset(1720, 1000, 32, 0.999, 1)} />
        <Chip size="small" variant="outlined" label="clamp only" onClick={() => applyPreset(1720, 1000, 32, EXPECTED_CLAMP, 1)} />
        <Chip size="small" variant="outlined" label="Rank Points" onClick={() => applyPreset(1720, 1000, 32, EXPECTED_CLAMP, RANK_POINT_SCALE)} />
      </Stack>

      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
        Guaranteed minimum for a win at the current K and clamp:{" "}
        <strong>{signed(Math.round(kFactor * (1 - Math.min(cap, 1)) * unit))}</strong>
        {unit === RANK_POINT_SCALE ? " RP" : " pts"}. At 1720 vs 1000 with K=32, "none" pays 0; the
        0.90 clamp lifts the win; ×{RANK_POINT_SCALE} turns the whole ladder into Rank Points and the
        floor becomes worth chasing.
      </Typography>
    </Paper>
  );
}

export default PayoutDemo;
