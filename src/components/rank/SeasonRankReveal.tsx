import { useEffect, useState } from "react";
import { Box, Button, Chip, IconButton, LinearProgress, Stack, Typography, alpha, useTheme } from "@mui/material";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import CloseIcon from "@mui/icons-material/Close";
import GroupsIcon from "@mui/icons-material/Groups";
import { useT } from "~/lib/useT";
import { TIER_COLORS, TIER_NAMES, tierProgress } from "~/lib/seasonRank";
import {
  buildRankExplainerHref,
  outcomeFromScore,
  type SeasonRankMovement,
  type SeasonRankStanding,
} from "~/lib/rankExplainer";

const COUNT_MS = 900;

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

export interface SeasonRankRevealProps {
  eventId: string;
  historyId: string | null;
  /** Per-game movement — present only when this Game counted. */
  rank?: SeasonRankMovement | null;
  /** Current standing — present whether or not this Game is scored yet. */
  standing?: SeasonRankStanding | null;
  scoreOne: number | null;
  scoreTwo: number | null;
  /** Inline strips the card chrome so it can share its parent's card. */
  inline?: boolean;
  onDismiss?: () => void;
}

/**
 * The viewer's Season Rank section for the just-played Game, in two states:
 *
 *  - **standing** (no score yet): where the player sits right now, with a cue
 *    that scoring this Game is what moves it. No delta — nothing moved yet.
 *  - **movement** (scored): the before→after count-up, RP delta and tier-up,
 *    exactly as the reveal has always behaved.
 *
 * Both states carry the viewer's Crew placement and a link straight to the
 * Season page, so the section is a doorway rather than a dead end.
 */
export function SeasonRankReveal({
  eventId,
  historyId,
  rank,
  standing,
  scoreOne,
  scoreTwo,
  inline = false,
  onDismiss,
}: SeasonRankRevealProps) {
  const t = useT();
  const theme = useTheme();

  const counted = !!rank?.counted;
  const seasonId = (counted ? rank?.seasonId : standing?.seasonId) ?? null;
  const seasonName = (counted ? rank?.seasonName : standing?.seasonName) ?? "";
  const provisional = counted ? !!rank?.provisional : !!standing?.provisional;
  const gamesThisSeason = counted ? rank?.gamesThisSeason ?? 0 : standing?.gamesThisSeason ?? 0;
  const edges = (counted ? rank?.edges : standing?.edges) ?? [];
  const tier = counted ? rank?.tierAfter ?? 0 : standing?.tier ?? 0;
  const settledRank = counted ? rank?.after ?? 0 : standing?.rank ?? 0;
  const tierColor = TIER_COLORS[tier] ?? TIER_COLORS[0];
  const tierName = TIER_NAMES[tier] ?? TIER_NAMES[0];
  const crew = standing?.crew ?? null;

  const positive = counted && !!rank && rank.delta > 0;
  const negative = counted && !!rank && rank.delta < 0;
  const deltaColor = positive ? theme.palette.success.main : negative ? theme.palette.error.main : theme.palette.text.secondary;
  const sameTier = counted && !!rank && rank.tierBefore === rank.tierAfter;
  const fromPct = counted && rank && !provisional
    ? (sameTier ? tierProgress(rank.before, tier, edges).pct : 0)
    : 0;
  const toPct = provisional ? 0 : tierProgress(settledRank, tier, edges).pct;

  // Animate only the first time a scored reveal is seen, per device. A standing
  // never animates: there is no movement to feel, and counting up would imply
  // one. Decided once on mount so re-renders never replay.
  const [animate] = useState(() => {
    if (!counted || !rank) return false;
    try {
      const first = !localStorage.getItem(`rank:reveal:${eventId}:${historyId ?? ""}`) && !prefersReducedMotion();
      localStorage.setItem(`rank:reveal:${eventId}:${historyId ?? ""}`, "1");
      return first;
    } catch { return false; }
  });
  const [display, setDisplay] = useState(() => (animate && rank ? rank.before : settledRank));
  const [barPct, setBarPct] = useState(() => (animate ? fromPct : toPct));
  const [settled, setSettled] = useState(() => !animate);

  useEffect(() => {
    if (!animate || !rank) return;
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
  }, [animate, rank, fromPct, toPct]);

  if (!counted && !standing) return null;
  if (!seasonId) return null;

  const href = counted && rank
    ? buildRankExplainerHref(eventId, {
        seasonId: rank.seasonId,
        rank: rank.after,
        delta: rank.delta,
        outcome: outcomeFromScore(scoreOne, scoreTwo),
      })
    : null;
  const progress = provisional ? null : tierProgress(settledRank, tier, edges);
  const unlockTotal = 3;
  const needsScore = !counted;

  const chrome = inline
    ? {}
    : {
        position: "relative" as const,
        overflow: "hidden" as const,
        p: 2,
        borderRadius: 3,
        bgcolor: alpha(tierColor, 0.06),
        border: `1px solid ${alpha(tierColor, 0.28)}`,
      };

  return (
    <Box
      data-testid="season-rank-reveal"
      sx={{
        ...chrome,
        ...(inline
          ? { py: 1.75 }
          : { animation: "pgbRankIn 480ms ease", "@keyframes pgbRankIn": {
              "0%": { opacity: 0, transform: "translateY(8px) scale(0.985)" },
              "100%": { opacity: 1, transform: "translateY(0) scale(1)" },
            } }),
      }}
    >
      <Stack spacing={1.25}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Typography
            variant="caption"
            sx={{ fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "text.secondary", flex: 1 }}
          >
            {counted ? t("postGameRankUpdatedTitle") : t("postGameRankStandingTitle")}
          </Typography>
          {onDismiss && (
            <IconButton
              size="small"
              onClick={onDismiss}
              aria-label={t("postGameRankDismiss")}
              data-testid="season-rank-dismiss"
              sx={{ mr: -0.75, mt: -0.5, color: "text.disabled" }}
            >
              <CloseIcon fontSize="inherit" sx={{ fontSize: 16 }} />
            </IconButton>
          )}
        </Box>

        {provisional ? (
          <Box>
            <Typography variant="h5" fontWeight={800} sx={{ lineHeight: 1.1 }}>
              {t("seasonRankProvisional")}
            </Typography>
            <LinearProgress
              variant="determinate"
              value={(Math.min(gamesThisSeason, unlockTotal) / unlockTotal) * 100}
              sx={{ mt: 1, height: 6, borderRadius: 3, bgcolor: alpha(theme.palette.text.primary, 0.08), "& .MuiLinearProgress-bar": { bgcolor: tierColor, borderRadius: 3, transition: "transform 700ms ease" } }}
            />
            <Typography variant="caption" color="text.secondary">{t("postGameRankUnlock", { n: gamesThisSeason })}</Typography>
          </Box>
        ) : (
          <>
            <Box sx={{ display: "flex", alignItems: "baseline", gap: 1.25, flexWrap: "wrap" }}>
              <Typography
                data-testid="rank-value"
                sx={{ fontSize: "2rem", fontWeight: 800, lineHeight: 1, color: tierColor, fontVariantNumeric: "tabular-nums" }}
              >
                {display}
              </Typography>
              {counted && rank && (
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
              )}
              <Chip
                size="small"
                label={tierName}
                sx={{ fontWeight: 800, color: tierColor, bgcolor: alpha(tierColor, 0.14), border: `1px solid ${alpha(tierColor, 0.45)}` }}
              />
            </Box>

            {counted && rank && rank.tierAfter > rank.tierBefore && (
              <Typography variant="caption" sx={{ color: tierColor, fontWeight: 700 }}>
                {t("postGameRankTierUp", { tier: tierName })}
              </Typography>
            )}

            {/* Tier bar only means something while there is a tier ahead: at the
                top tier it would sit at 100% forever, a meter that never moves. */}
            {progress && progress.nextTier !== null && progress.toNext !== null ? (
              <Box>
                <LinearProgress
                  variant="determinate"
                  value={Math.max(0, Math.min(100, counted ? barPct : toPct))}
                  sx={{ height: 6, borderRadius: 3, bgcolor: alpha(theme.palette.text.primary, 0.08), "& .MuiLinearProgress-bar": { bgcolor: tierColor, borderRadius: 3 } }}
                />
                <Typography variant="caption" color="text.secondary">
                  {t("postGameRankToNext", { n: progress.toNext, tier: TIER_NAMES[progress.nextTier] })}
                </Typography>
              </Box>
            ) : (
              <Typography variant="caption" color="text.secondary">
                {t("seasonRankTopTier")}
              </Typography>
            )}
          </>
        )}

        {/* Neutral notice, not a warning: the checklist right below owns the
            "add the score" button, so this row only explains the delay. */}
        {needsScore && (
          <Typography
            variant="caption"
            data-testid="season-rank-needs-score"
            color="text.secondary"
            sx={{ display: "block", py: 0.5 }}
          >
            {t("postGameRankCue")}
          </Typography>
        )}

        {crew && (
          <Box
            data-testid="season-rank-crew"
            sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}
          >
            <GroupsIcon fontSize="inherit" sx={{ fontSize: 16, color: "text.disabled" }} />
            <Typography variant="caption" color="text.secondary" fontWeight={700}>
              {t("postGameRankCrewLabel")}
            </Typography>
            <Chip size="small" label={crew.name} sx={{ fontWeight: 700, height: 20 }} />
            <Typography variant="caption" color="text.secondary">
              {t("postGameRankCrewPlace", { place: crew.place, total: crew.placeCount })}
              {" · "}
              {t("postGameRankCrewPoints", { n: crew.points })}
            </Typography>
            {/* Crews only ever earn points, so a payout chip means "up". Place
                is already shown as "#n of m" and rarely moves on its own. */}
            {crew.pointsDelta !== null && crew.pointsDelta > 0 && (
              <Chip
                size="small"
                data-testid="season-rank-crew-delta"
                icon={<ArrowUpwardIcon />}
                label={t("postGameRankCrewPointsDelta", { n: crew.pointsDelta })}
                sx={{
                  height: 20, fontWeight: 800,
                  color: theme.palette.success.main,
                  bgcolor: alpha(theme.palette.success.main, 0.14),
                  border: `1px solid ${alpha(theme.palette.success.main, 0.4)}`,
                  "& .MuiChip-icon": { color: "inherit", fontSize: 14 },
                }}
              />
            )}
          </Box>
        )}

        {/* The two links read as one row: explainer first, season page after. */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mt: -0.5, flexWrap: "wrap" }}>
          {href && (
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
          )}
          <Button
            component="a"
            href={`/events/${eventId}/seasons/${seasonId}`}
            size="small"
            variant="text"
            data-testid="season-rank-season-link"
            aria-label={t("postGameRankViewSeasonAria", { season: seasonName })}
            sx={{ textTransform: "none", fontWeight: 700, color: "primary.main", minWidth: 0, py: 0.25 }}
          >
            {t("postGameRankViewSeason")}
          </Button>
        </Box>
      </Stack>
    </Box>
  );
}

export default SeasonRankReveal;
