import { Box, Button, Chip, LinearProgress, Stack, Typography, alpha, useTheme } from "@mui/material";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import { useT } from "~/lib/useT";
import { TIER_COLORS, TIER_NAMES, tierProgress } from "~/lib/seasonRank";
import { buildRankExplainerHref, outcomeFromScore, type SeasonRankMovement } from "~/lib/rankExplainer";

/**
 * Compact reveal of the viewer's Season Rank movement for the just-played
 * Game: before -> after, the Rank Point delta, and progress toward the next
 * Tier (or the provisional unlock counter). Links to the per-event explainer
 * pre-filled with this Game's numbers.
 */
export function SeasonRankReveal({ eventId, rank, scoreOne, scoreTwo }: {
  eventId: string;
  rank: SeasonRankMovement;
  scoreOne: number | null;
  scoreTwo: number | null;
}) {
  const t = useT();
  const theme = useTheme();
  if (!rank.counted) return null;

  const positive = rank.delta > 0;
  const negative = rank.delta < 0;
  const deltaColor = positive ? theme.palette.success.main : negative ? theme.palette.error.main : theme.palette.text.secondary;
  const tierName = TIER_NAMES[rank.tierAfter] ?? TIER_NAMES[0];
  const tierColor = TIER_COLORS[rank.tierAfter] ?? TIER_COLORS[0];
  const progress = rank.provisional ? null : tierProgress(rank.after, rank.tierAfter, rank.edges);
  const href = buildRankExplainerHref(eventId, {
    seasonId: rank.seasonId,
    rank: rank.after,
    delta: rank.delta,
    outcome: outcomeFromScore(scoreOne, scoreTwo),
  });

  return (
    <Box
      data-testid="season-rank-reveal"
      sx={{
        p: 1.5,
        borderRadius: 2,
        bgcolor: alpha(tierColor, 0.06),
        border: `1px solid ${alpha(tierColor, 0.3)}`,
        animation: "pgbRankIn 500ms ease",
        "@keyframes pgbRankIn": {
          "0%": { opacity: 0, transform: "translateY(6px)" },
          "100%": { opacity: 1, transform: "translateY(0)" },
        },
      }}
    >
      <Stack spacing={1}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <TrendingUpIcon fontSize="small" sx={{ color: tierColor }} />
          <Typography variant="body2" fontWeight={700} sx={{ flex: 1 }}>
            {t("postGameRankTitle")}
          </Typography>
          <Typography variant="caption" color="text.secondary">{rank.seasonName}</Typography>
        </Box>

        <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
          <Typography variant="h6" fontWeight={800} color="text.secondary" sx={{ lineHeight: 1 }}>
            {rank.before}
          </Typography>
          <ArrowForwardIcon fontSize="small" sx={{ color: "text.disabled" }} />
          <Typography variant="h5" fontWeight={800} sx={{ color: tierColor, lineHeight: 1 }}>
            {rank.after}
          </Typography>
          <Chip
            size="small"
            label={t("postGameRankDelta", { delta: `${positive ? "+" : ""}${rank.delta}` })}
            sx={{ fontWeight: 700, color: deltaColor, bgcolor: alpha(deltaColor, 0.12), border: `1px solid ${alpha(deltaColor, 0.4)}` }}
          />
          {rank.provisional ? (
            <Chip size="small" variant="outlined" label={t("seasonRankProvisional")} sx={{ fontWeight: 700, color: "text.secondary" }} />
          ) : (
            <Chip
              size="small"
              label={tierName}
              sx={{ fontWeight: 700, color: tierColor, bgcolor: alpha(tierColor, 0.14), border: `1px solid ${alpha(tierColor, 0.45)}` }}
            />
          )}
        </Box>

        {rank.provisional ? (
          <Typography variant="caption" color="text.secondary">
            {t("postGameRankUnlock", { n: rank.gamesThisSeason })}
          </Typography>
        ) : (
          <>
            {rank.tierAfter > rank.tierBefore && (
              <Typography variant="caption" sx={{ color: tierColor, fontWeight: 700 }}>
                {t("postGameRankTierUp", { tier: tierName })}
              </Typography>
            )}
            {progress && (
              <Box>
                <LinearProgress
                  variant="determinate"
                  value={Math.max(0, Math.min(100, progress.pct))}
                  sx={{
                    height: 7,
                    borderRadius: 4,
                    bgcolor: alpha(theme.palette.text.primary, 0.08),
                    "& .MuiLinearProgress-bar": { bgcolor: tierColor, borderRadius: 4, transition: "transform 700ms ease" },
                  }}
                />
                <Typography variant="caption" color="text.secondary">
                  {progress.nextTier !== null && progress.toNext !== null
                    ? t("postGameRankToNext", { n: progress.toNext, tier: TIER_NAMES[progress.nextTier] })
                    : t("seasonRankTopTier")}
                </Typography>
              </Box>
            )}
          </>
        )}

        <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
          <Button
            component="a"
            href={href}
            size="small"
            variant="text"
            startIcon={<InfoOutlinedIcon fontSize="small" />}
            aria-label={t("postGameRankWhyAria")}
            sx={{ textTransform: "none", fontWeight: 600 }}
          >
            {t("postGameRankWhy")}
          </Button>
        </Box>
      </Stack>
    </Box>
  );
}

export default SeasonRankReveal;
