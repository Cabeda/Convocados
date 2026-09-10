/**
 * PROTOTYPE — Tier-transition moment (throwaway). dex 20jkpipd / l5m5ao3p.
 * Real MUI, app shell. Three presentations of the same moment:
 *   A — full-screen modal takeover
 *   B — inline card on the Ratings page
 *   C — toast / snackbar
 * UP = earned competence signal + confetti + "to-go" next target (no reward chest).
 * DOWN = one calm message, fresh-start framing, path back (no shame, no confetti).
 */
import { useState } from "react";
import {
  Container, Paper, Typography, Box, Stack, Chip, Button, Avatar,
  Dialog, DialogContent, Snackbar, Alert, LinearProgress, alpha, useTheme,
  ToggleButton, ToggleButtonGroup,
} from "@mui/material";
import { keyframes } from "@emotion/react";
import EmojiEventsIcon from "@mui/icons-material/EmojiEvents";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import { ThemeModeProvider } from "./ThemeModeProvider";
import { ResponsiveLayout } from "./ResponsiveLayout";

const TIER_COLORS = ["#8c6a4a", "#8892a0", "#c9a227", "#3fa8a0", "#5b8def", "#9b6bff"];
const fall = keyframes`
  0% { transform: translateY(-12px) rotate(0deg); opacity: 1; }
  100% { transform: translateY(340px) rotate(560deg); opacity: 0; }
`;
const pop = keyframes`
  0% { transform: scale(0.6); opacity: 0; }
  60% { transform: scale(1.08); opacity: 1; }
  100% { transform: scale(1); opacity: 1; }
`;
const PIECES = Array.from({ length: 26 }, (_, i) => ({
  left: (i * 37) % 100,
  delay: (i % 7) * 0.12,
  color: TIER_COLORS[i % TIER_COLORS.length],
  size: 6 + (i % 4) * 2,
}));

type Kind = "up" | "down";
type Variant = "A" | "B" | "C";

const UP = { from: 1, to: 2, games: 12, next: "Platinum", toNext: 120 };
const DOWN = { from: 4, to: 3, winsBack: 3, climbed: "Silver → Diamond" };
const NAMES = ["Bronze", "Silver", "Gold", "Platinum", "Diamond", "Master"];

function Confetti() {
  return (
    <Box sx={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}>
      {PIECES.map((p, i) => (
        <Box
          key={i}
          sx={{
            position: "absolute", top: 0, left: `${p.left}%`, width: p.size, height: p.size * 0.6,
            bgcolor: p.color, borderRadius: "1px",
            animation: `${fall} ${1.1 + (i % 5) * 0.15}s ease-in ${p.delay}s both`,
          }}
        />
      ))}
    </Box>
  );
}

function Badge({ tier, size = 64 }: { tier: number; size?: number }) {
  const c = TIER_COLORS[tier];
  return (
    <Avatar sx={{ width: size, height: size, bgcolor: alpha(c, 0.18), color: c, border: `2px solid ${alpha(c, 0.5)}`, animation: `${pop} 0.5s ease-out both` }}>
      <EmojiEventsIcon sx={{ fontSize: size * 0.5 }} />
    </Avatar>
  );
}

function Content({ kind, compact = false }: { kind: Kind; compact?: boolean }) {
  if (kind === "up") {
    const c = TIER_COLORS[UP.to];
    return (
      <Stack spacing={1.5} alignItems="center" sx={{ textAlign: "center" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
          <Badge tier={UP.from} size={compact ? 40 : 52} />
          <ArrowUpwardIcon sx={{ color: c }} />
          <Badge tier={UP.to} size={compact ? 52 : 64} />
        </Box>
        <Typography variant={compact ? "subtitle1" : "h5"} fontWeight={800} sx={{ color: c }}>
          You reached {NAMES[UP.to]}!
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Earned over {UP.games} games this season — not a prize, just your form.
        </Typography>
        <Box sx={{ width: "100%", maxWidth: 320 }}>
          <LinearProgress
            variant="determinate" value={62}
            sx={{ height: 8, borderRadius: 4, "& .MuiLinearProgress-bar": { bgcolor: c } }}
          />
          <Typography variant="caption" color="text.secondary">{UP.toNext} to {UP.next}</Typography>
        </Box>
      </Stack>
    );
  }
  const c = TIER_COLORS[DOWN.to];
  return (
    <Stack spacing={1.5} alignItems="center" sx={{ textAlign: "center" }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
        <Badge tier={DOWN.from} size={compact ? 40 : 52} />
        <Typography sx={{ color: "text.secondary" }}>→</Typography>
        <Badge tier={DOWN.to} size={compact ? 52 : 64} />
      </Box>
      <Typography variant={compact ? "subtitle1" : "h5"} fontWeight={800}>
        New season, fresh start
      </Typography>
      <Typography variant="body2" color="text.secondary">
        Your Rank soft-reset. You’re <b>{DOWN.winsBack} wins</b> from {NAMES[DOWN.from]}.
      </Typography>
      <Typography variant="caption" color="text.secondary">
        Last season you climbed {DOWN.climbed}. You’ve got this.
      </Typography>
      <Button size="small" variant="text" sx={{ color: c }}>See your path back</Button>
    </Stack>
  );
}

function RatingsMock() {
  const rows = [
    { name: "Rita", tier: 5, rank: 235 },
    { name: "Marco", tier: 5, rank: 213 },
    { name: "You", tier: 2, rank: 104, you: true },
    { name: "Inês", tier: 4, rank: 118 },
  ];
  const theme = useTheme();
  return (
    <Paper elevation={2} sx={{ borderRadius: 3, overflow: "hidden" }}>
      <Box sx={{ p: 2 }}>
        <Typography variant="h6" fontWeight={700}>Ratings</Typography>
        <Typography variant="caption" color="text.secondary">Season Rank</Typography>
      </Box>
      {rows.map((r) => (
        <Box key={r.name} sx={{ display: "flex", alignItems: "center", gap: 1.5, px: 2, py: 1, bgcolor: r.you ? alpha(theme.palette.primary.main, 0.08) : undefined }}>
          <Typography variant="body2" sx={{ flex: 1 }} fontWeight={r.you ? 700 : 400}>{r.name}</Typography>
          <Chip size="small" label={NAMES[r.tier]} sx={{ color: TIER_COLORS[r.tier], bgcolor: alpha(TIER_COLORS[r.tier], 0.14), fontWeight: 700 }} />
          <Chip size="small" variant="outlined" label={r.rank} sx={{ color: TIER_COLORS[r.tier], borderColor: alpha(TIER_COLORS[r.tier], 0.4), fontWeight: 700 }} />
        </Box>
      ))}
    </Paper>
  );
}

export default function PrototypeTierTransition() {
  const [kind, setKind] = useState<Kind>("up");
  const [variant, setVariant] = useState<Variant>("A");
  const [open, setOpen] = useState(true);

  const replay = (k?: Kind) => { if (k) setKind(k); setOpen(true); };

  return (
    <ThemeModeProvider>
      <ResponsiveLayout>
        <Container maxWidth="md" sx={{ py: 3 }}>
          <Stack spacing={2}>
            <Box>
              <Typography variant="h5" fontWeight={700}>Tier transition</Typography>
              <Typography variant="body2" color="text.secondary">PROTOTYPE — trigger a moment, switch presentation</Typography>
            </Box>

            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Button variant={kind === "up" ? "contained" : "outlined"} startIcon={<EmojiEventsIcon />} onClick={() => replay("up")}>Tier up</Button>
              <Button variant={kind === "down" ? "contained" : "outlined"} onClick={() => replay("down")}>Tier down</Button>
            </Stack>

            <ToggleButtonGroup exclusive size="small" value={variant} onChange={(_, v) => v && setVariant(v)}>
              <ToggleButton value="A">A · Modal</ToggleButton>
              <ToggleButton value="B">B · Inline card</ToggleButton>
              <ToggleButton value="C">C · Toast</ToggleButton>
            </ToggleButtonGroup>

            {variant === "B" && open && (
              <Paper elevation={3} sx={{ position: "relative", borderRadius: 3, p: 2, overflow: "hidden", border: `1px solid ${alpha(kind === "up" ? TIER_COLORS[UP.to] : TIER_COLORS[DOWN.to], 0.4)}` }}>
                {kind === "up" && <Confetti />}
                <Box sx={{ position: "relative" }}><Content kind={kind} compact /></Box>
              </Paper>
            )}

            <RatingsMock />

            <Typography variant="caption" color="text.secondary">
              Variant A opens a modal; C a toast. B is inline above. Rules from dex cts8l8dl.
            </Typography>
          </Stack>
        </Container>

        <Dialog open={variant === "A" && open} onClose={() => setOpen(false)} maxWidth="xs" fullWidth>
          <DialogContent sx={{ position: "relative", overflow: "hidden", py: 4 }}>
            {kind === "up" && <Confetti />}
            <Box sx={{ position: "relative" }}>
              <Content kind={kind} />
              <Box sx={{ display: "flex", justifyContent: "center", mt: 3 }}>
                <Button variant="contained" onClick={() => setOpen(false)}>Continue</Button>
              </Box>
            </Box>
          </DialogContent>
        </Dialog>

        <Snackbar open={variant === "C" && open} autoHideDuration={6000} onClose={() => setOpen(false)} anchorOrigin={{ vertical: "bottom", horizontal: "center" }}>
          <Alert severity={kind === "up" ? "success" : "info"} variant="filled" onClose={() => setOpen(false)} sx={{ maxWidth: 420 }}>
            {kind === "up"
              ? `You reached ${NAMES[UP.to]}! ${UP.toNext} to ${UP.next}.`
              : `New season, fresh start — ${DOWN.winsBack} wins from ${NAMES[DOWN.from]}.`}
          </Alert>
        </Snackbar>
      </ResponsiveLayout>
    </ThemeModeProvider>
  );
}
