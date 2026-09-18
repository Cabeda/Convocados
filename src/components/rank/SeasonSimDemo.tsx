import { useMemo, useState } from "react";
import {
  Box, Button, Chip, LinearProgress, Paper, Slider, Stack,
  ToggleButton, ToggleButtonGroup, Typography,
} from "@mui/material";
import { expectedScore } from "~/lib/elo";
import { TIER_NAMES, rankDelta, seedRank } from "~/lib/seasonRank";

export type SeasonSimMode = "current" | "rp";

interface Tick {
  key: string;
  delta: number;
}

export interface SeasonSimDemoProps {
  /** Your skill rating. Defaults to the Convocados case (1720). */
  yourRating?: number;
  /** Field average rating. Defaults to 1000. */
  opponentAvg?: number;
  /** Payout mode: "current" (K=32, ×1, no clamp) or "rp" (clamp + Rank Points). */
  mode?: SeasonSimMode;
  /** Illustrative tier band width, in the active unit. Defaults to 1500. */
  band?: number;
  /** Rounds in a Season. Defaults to 8. */
  rounds?: number;
}

const ANCHOR = 1000;
const DRAW_BAND = 0.15;
const CURRENT_K = 32;

function num(value: number | number[]): number {
  return Array.isArray(value) ? value[0] : value;
}

function signed(value: number): string {
  return (value > 0 ? "+" : "") + value;
}

function seedFor(mode: SeasonSimMode, skill: number): number {
  return mode === "rp" ? seedRank(skill, ANCHOR) : Math.max(0, skill - ANCHOR);
}

/**
 * Lesson 4 — play an eight-round Season and compare the two payout designs.
 * "current" quietly pays a favourite almost nothing per win; "Rank Points"
 * pays every game, which is the motivation argument made measurable.
 */
export function SeasonSimDemo({
  yourRating = 1720,
  opponentAvg = 1000,
  mode: initialMode = "rp",
  band: initialBand = 1500,
  rounds = 8,
}: SeasonSimDemoProps) {
  const [mode, setMode] = useState<SeasonSimMode>(initialMode);
  const [you, setYou] = useState(yourRating);
  const [opp, setOpp] = useState(opponentAvg);
  const [band, setBand] = useState(initialBand);
  const [deltas, setDeltas] = useState<Tick[] | null>(null);
  const [record, setRecord] = useState<{ w: number; d: number; l: number } | null>(null);

  const startRp = useMemo(() => seedFor(mode, you), [mode, you]);
  const total = useMemo(
    () => (deltas ? deltas.reduce((sum, t) => sum + t.delta, 0) : 0),
    [deltas],
  );
  const finalRp = startRp + total;
  const tier = Math.max(0, Math.floor(finalRp / band));
  const progress = deltas ? ((finalRp % band) / band) * 100 : 0;

  const reset = () => {
    setDeltas(null);
    setRecord(null);
  };

  const play = () => {
    const pWin = expectedScore(you, opp);
    const next: Tick[] = [];
    let w = 0;
    let d = 0;
    let l = 0;
    for (let i = 0; i < rounds; i++) {
      const roll = Math.random();
      let s: number;
      if (roll < pWin) {
        s = 1;
        w += 1;
      } else if (roll < pWin + DRAW_BAND) {
        s = 0.5;
        d += 1;
      } else {
        s = 0;
        l += 1;
      }
      const delta = mode === "rp"
        ? rankDelta(you, opp, s, { seeded: true, provisionalWindow: 3, seasonGames: i })
        : Math.round(CURRENT_K * (s - pWin));
      next.push({ key: Math.random().toString(36).slice(2), delta });
    }
    setDeltas(next);
    setRecord({ w, d, l });
  };

  const nextTierName = TIER_NAMES[Math.min(tier + 1, TIER_NAMES.length - 1)];

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 2.5 }, borderRadius: 2, my: 2 }}>
      <Typography variant="h6" fontWeight={700} gutterBottom>
        Play a season
      </Typography>

      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 2 }}>
        <Box>
          <Typography variant="overline" color="text.secondary">
            Your skill · {you}
          </Typography>
          <Slider value={you} min={800} max={2200} step={10} size="small" onChange={(_, v) => { setYou(num(v)); reset(); }} aria-label="Your skill" />
        </Box>
        <Box>
          <Typography variant="overline" color="text.secondary">
            Field average · {opp}
          </Typography>
          <Slider value={opp} min={800} max={2200} step={10} size="small" onChange={(_, v) => { setOpp(num(v)); reset(); }} aria-label="Field average" />
        </Box>
        <Box>
          <Typography variant="overline" color="text.secondary">
            Payout
          </Typography>
          <ToggleButtonGroup
            exclusive
            fullWidth
            size="small"
            value={mode}
            onChange={(_, v: SeasonSimMode | null) => { if (v !== null) { setMode(v); reset(); } }}
            aria-label="Payout mode"
          >
            <ToggleButton value="current" sx={{ textTransform: "none" }}>current</ToggleButton>
            <ToggleButton value="rp" sx={{ textTransform: "none" }}>Rank Points</ToggleButton>
          </ToggleButtonGroup>
        </Box>
        <Box>
          <Typography variant="overline" color="text.secondary">
            Tier band (illustrative) · {band}
          </Typography>
          <Slider value={band} min={500} max={4000} step={100} size="small" onChange={(_, v) => { setBand(num(v)); reset(); }} aria-label="Tier band" />
        </Box>
      </Box>

      <Typography variant="body2" sx={{ mt: 2, fontFamily: "ui-monospace, monospace" }}>
        Starting RP = <strong>{startRp}</strong> · Start tier ={" "}
        <strong>{TIER_NAMES[Math.min(Math.max(0, Math.floor(startRp / band)), TIER_NAMES.length - 1)]}</strong>
      </Typography>

      <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 1.5, minHeight: 32 }}>
        {deltas?.map((t) => (
          <Chip
            key={t.key}
            size="small"
            label={signed(t.delta)}
            color={t.delta > 0 ? "success" : "default"}
            variant={t.delta > 0 ? "outlined" : "filled"}
            sx={{ fontFamily: "ui-monospace, monospace" }}
          />
        ))}
      </Stack>

      <LinearProgress
        variant="determinate"
        value={Math.max(0, Math.min(100, progress))}
        sx={{ height: 10, borderRadius: 5, mt: 1.5 }}
      />

      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
        {record
          ? `${record.w}W ${record.d}D ${record.l}L · final ${finalRp} RP · ${progress.toFixed(0)}% to ${nextTierName}`
          : "Play the eight-round Season."}
      </Typography>

      <Box sx={{ mt: 1.5 }}>
        <Button size="small" variant="contained" onClick={play}>
          Play season
        </Button>
      </Box>
    </Paper>
  );
}

export default SeasonSimDemo;
