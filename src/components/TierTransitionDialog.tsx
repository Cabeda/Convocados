import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, Typography, Box, Stack, Button, Avatar,
  alpha, keyframes,
} from "@mui/material";
import EmojiEventsIcon from "@mui/icons-material/EmojiEvents";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import { TIER_COLORS, TIER_NAMES } from "~/lib/seasonRank";
import { useT } from "~/lib/useT";

const fall = keyframes`
  0% { transform: translateY(-12px) rotate(0deg); opacity: 1; }
  100% { transform: translateY(340px) rotate(560deg); opacity: 0; }
`;
const pop = keyframes`
  0% { transform: scale(0.6); opacity: 0; }
  60% { transform: scale(1.08); opacity: 1; }
  100% { transform: scale(1); opacity: 1; }
`;
const PIECES = Array.from({ length: 24 }, (_, i) => ({
  left: (i * 37) % 100, delay: (i % 7) * 0.12, color: TIER_COLORS[i % TIER_COLORS.length], size: 6 + (i % 4) * 2,
}));

function Confetti() {
  return (
    <Box sx={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}>
      {PIECES.map((p, i) => (
        <Box key={i} sx={{ position: "absolute", top: 0, left: `${p.left}%`, width: p.size, height: p.size * 0.6, bgcolor: p.color, borderRadius: "1px", animation: `${fall} ${1.1 + (i % 5) * 0.15}s ease-in ${p.delay}s both` }} />
      ))}
    </Box>
  );
}

function Badge({ tier, size = 64 }: { tier: number; size?: number }) {
  const c = TIER_COLORS[tier] ?? TIER_COLORS[0];
  return (
    <Avatar sx={{ width: size, height: size, bgcolor: alpha(c, 0.18), color: c, border: `2px solid ${alpha(c, 0.5)}`, animation: `${pop} 0.5s ease-out both` }}>
      <EmojiEventsIcon sx={{ fontSize: size * 0.5 }} />
    </Avatar>
  );
}

interface TierTransition {
  kind: "up" | "down";
  from: number;
  to: number;
  toNext: number;
}

/**
 * Full-screen modal for a Season Rank tier change (ADR 0031 / dex l5m5ao3p).
 * UP: earned-competence celebration + to-go next tier. DOWN: calm fresh start
 * + path back. Fires once per transition, tracked per Season in localStorage.
 */
export function TierTransitionDialog({ players, seasonId, youName }: {
  players: { name: string; tier: number; display: number; provisional: boolean }[];
  seasonId: string;
  youName?: string | null;
}) {
  const [transition, setTransition] = useState<TierTransition | null>(null);
  const [open, setOpen] = useState(false);
  const t = useT();

  useEffect(() => {
    if (!youName) return;
    const you = players.find((p) => p.name === youName);
    if (!you || you.provisional) return;
    const key = `rank:tier:${seasonId}:${youName}`;
    const prevRaw = (() => {
      try {
        const value = localStorage.getItem(key);
        localStorage.setItem(key, String(you.tier));
        return value;
      } catch {
        return undefined;
      }
    })();
    if (prevRaw === undefined || prevRaw === null) return;
    const prev = Number.parseInt(prevRaw, 10);
    if (Number.isNaN(prev) || prev === you.tier) return;
    setTransition({ kind: you.tier > prev ? "up" : "down", from: prev, to: you.tier, toNext: 0 });
    setOpen(true);
  }, [players, seasonId, youName]);

  if (!transition) return null;
  const up = transition.kind === "up";
  const c = TIER_COLORS[transition.to] ?? TIER_COLORS[0];

  return (
    <Dialog open={open} onClose={() => setOpen(false)} maxWidth="xs" fullWidth>
      <DialogContent sx={{ position: "relative", overflow: "hidden", py: 4 }}>
        {up && <Confetti />}
        <Box sx={{ position: "relative" }}>
          <Stack spacing={1.5} alignItems="center" sx={{ textAlign: "center" }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
              <Badge tier={transition.from} size={52} />
              {up ? <ArrowUpwardIcon sx={{ color: c }} /> : <Typography sx={{ color: "text.secondary" }}>→</Typography>}
              <Badge tier={transition.to} size={64} />
            </Box>
            {up ? (
              <>
                <Typography variant="h5" fontWeight={800} sx={{ color: c }}>{t("tierUpTitle", { tier: TIER_NAMES[transition.to] })}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {t("tierUpBody")}
                </Typography>
              </>
            ) : (
              <>
                <Typography variant="h5" fontWeight={800}>{t("tierDownTitle")}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {t("tierDownBody", { tier: TIER_NAMES[transition.to] })}
                </Typography>
              </>
            )}
            <Box sx={{ display: "flex", justifyContent: "center", mt: 2 }}>
              <Button variant="contained" onClick={() => setOpen(false)}>{t("continueAction")}</Button>
            </Box>
          </Stack>
        </Box>
      </DialogContent>
    </Dialog>
  );
}
