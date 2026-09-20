import { useEffect, useState } from "react";
import { Box, Button, Chip, LinearProgress, Stack, Typography, alpha, useTheme } from "@mui/material";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import { useT } from "~/lib/useT";
import { TIER_COLORS, TIER_NAMES, tierProgress } from "~/lib/seasonRank";
import { buildRankExplainerHref, outcomeFromScore, type SeasonRankMovement } from "~/lib/rankExplainer";

const COUNT_MS = 900;

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Compact, scannable reveal of the viewer's Season Rank movement for the
 * just-played Game. The Rank counts up from before → after on the first view
 * of a given game (persisted per game), so the movement is felt rather than
 * read; the delta pill and progress bar settle in behind it.
 */
export function SeasonRankReveal({ eventId, historyId, rank, scoreOne, scoreTwo }: {
  eventId: string;
  historyId: string | null;
  rank: SeasonRankMovement;
  scoreOne: number | null;
  scoreTwo: number | null;
}) {
  const t = useT();
  const theme = useTheme();

  const positive = rank.delta > 0;
  const negative = rank.delta < 0;
  const deltaColor = positive ? theme.palette.success.main : negative ? theme.palette.error.main : theme.palette.text.secondary;
  const tierColor = TIER_COLORS[rank.tierAfter] ?? TIER_COLORS[0];
  const tierName = TIER_NAMES[rank.tierAfter] ?? TIER_NAMES[0];
  const sameTier = rank.tierBefore === rank.tierAfter;
  const fromPct = rank.provisional || !sameTier ? 0 : tierProgress(rank.before, rank.tierAfter, rank.edges).pct;
  const toPct = rank.provisional ? 0 : tierProgress(rank.after, rank.tierAfter, rank.edges).pct;

  // Animate only the first time this game's reveal is seen, per device. Decided
  // once on mount (reading and marking the seen key), so re-renders never replay.
  const [animate] = useState(() => {
    if (!rank.counted) return false;
    try {
      const first = !localStorage.getItem(`rank:reveal:${eventId}:${historyId ?? ""}`) && !prefersReducedMotion();
      localStorage.setItem(`rank:reveal:${eventId}:${historyId ?? ""}`, "1");
      return first;
    } catch { return false; }
  });
  const [display, setDisplay] = useState(() => (animate ? rank.before : rank.after));
  const [barPct, setBarPct] = useState(() => (animate ? fromPct : toPct));
  const [settled, setSettled] = useState(() => !animate);

  useEffect(() => {
    if (!animate) return;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / COUNT_MS);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(Math.round(rank.before + (rank.after - rank.before) * eased));
      setBarPct(fromPct + (toPct - fromPct) * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
      else setSettled(true);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [animate, rank.before, rank.after, fromPct, toPct]);

  if (!rank.counted) return null;

  const href = buildRankExplainerHref(eventId, {
    seasonId: rank.seasonId,
    rank: rank.after,
    delta: rank.delta,
    outcome: outcomeFromScore(scoreOne, scoreTwo),
  });
  const progress = rank.provisional ? null : tierProgress(rank.after, rank.tierAfter, rank.edges);
  const unlockTotal = 3;

  return (
    <Box
      data-testid="season-rank-reveal"
      sx={{
        position: "relative",
        overflow: "hidden",
        p: 2,
        borderRadius: 3,
        bgcolor: alpha(tierColor, 0.06),
        border: `1px solid ${alpha(tierColor, 0.28)}`,
        animation: "pgbRankIn 480ms ease",
        "@keyframes pgbRankIn": {
          "0%": { opacity: 0, transform: "translateY(8px) scale(0.985)" },
          "100%": { opacity: 1, transform: "translateY(0) scale(1)" },
        },
      }}
    >
      <Stack spacing={1.25}>
        <Typography variant="caption" sx={{ fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "text.secondary" }}>
          {t("postGameRankTitle")}
        </Typography>

        {rank.provisional ? (
          <Box>
            <Typography variant="h5" fontWeight={800} sx={{ lineHeight: 1.1 }}>
              {t("seasonRankProvisional")}
            </Typography>
            <LinearProgress
              variant="determinate"
              value={(Math.min(rank.gamesThisSeason, unlockTotal) / unlockTotal) * 100}
              sx={{ mt: 1, height: 6, borderRadius: 3, bgcolor: alpha(theme.palette.text.primary, 0.08), "& .MuiLinearProgress-bar": { bgcolor: tierColor, borderRadius: 3, transition: "transform 700ms ease" } }}
            />
            <Typography variant="caption" color="text.secondary">{t("postGameRankUnlock", { n: rank.gamesThisSeason })}</Typography>
          </Box>
        ) : (
          <>
            <Box sx={{ display: "flex", alignItems: "baseline", gap: 1.25, flexWrap: "wrap" }}>
              <Typography
                data-testid="rank-value"
                sx={{ fontSize: "2.4rem", fontWeight: 800, lineHeight: 1, color: tierColor, fontVariantNumeric: "tabular-nums" }}
              >
                {display}
              </Typography>
              <Chip
                size="small"
                icon={positive ? <ArrowUpwardIcon /> : negative ? <ArrowDownwardIcon /> : undefined}
                label={t("postGameRankDelta", { delta: `${positive ? "+" : ""}${rank.delta}` })}
                sx={{
                  fontWeight: 800, color: deltaColor, bgcolor: alpha(deltaColor, 0.14),
                  border: `1px solid ${alpha(deltaColor, 0.4)}`,
                  "& .MuiChip-icon": { color: deltaColor, fontSize: 16 },
                  opacity: settled ? 1 : 0,
                  transform: settled ? "none" : "translateY(4px)",
                  transition: "opacity 350ms ease 150ms, transform 350ms ease 150ms",
                }}
              />
              <Chip
                size="small"
                label={tierName}
                sx={{ fontWeight: 800, color: tierColor, bgcolor: alpha(tierColor, 0.14), border: `1px solid ${alpha(tierColor, 0.45)}` }}
              />
            </Box>

            {rank.tierAfter > rank.tierBefore && (
              <Typography variant="caption" sx={{ color: tierColor, fontWeight: 700 }}>
                {t("postGameRankTierUp", { tier: tierName })}
              </Typography>
            )}

            <Box>
              <LinearProgress
                variant="determinate"
                value={Math.max(0, Math.min(100, barPct))}
                sx={{ height: 6, borderRadius: 3, bgcolor: alpha(theme.palette.text.primary, 0.08), "& .MuiLinearProgress-bar": { bgcolor: tierColor, borderRadius: 3 } }}
              />
              <Typography variant="caption" color="text.secondary">
                {progress && progress.nextTier !== null && progress.toNext !== null
                  ? t("postGameRankToNext", { n: progress.toNext, tier: TIER_NAMES[progress.nextTier] })
                  : t("seasonRankTopTier")}
              </Typography>
            </Box>
          </>
        )}

        <Box sx={{ display: "flex", justifyContent: "flex-end", mt: -0.5 }}>
          <Button
            component="a"
            href={href}
            size="small"
            variant="text"
            startIcon={<InfoOutlinedIcon sx={{ fontSize: 16 }} />}
            aria-label={t("postGameRankWhyAria")}
            sx={{ textTransform: "none", fontWeight: 600, color: "text.secondary", minWidth: 0, py: 0.25 }}
          >
            {t("postGameRankWhy")}
          </Button>
        </Box>
      </Stack>
    </Box>
  );
}

export default SeasonRankReveal;
