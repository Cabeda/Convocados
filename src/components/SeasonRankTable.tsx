import { useEffect, useMemo, useState } from "react";
import {
  Paper, Typography, Box, Chip, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, LinearProgress, Alert, alpha, useTheme, Skeleton,
} from "@mui/material";
import { TIER_COLORS, TIER_NAMES } from "~/lib/seasonRank";
import { useT } from "~/lib/useT";
import { TierTransitionDialog } from "./TierTransitionDialog";

interface RankPlayer {
  name: string;
  hidden: number;
  display: number;
  tier: number;
  tierName: string | null;
  games: number;
  provisional: boolean;
}
interface RankPayload {
  seasonId: string;
  players: RankPlayer[];
  edges: number[];
  anchor: number;
  gamesCount: number;
  enabled: boolean;
  youName?: string | null;
}

/**
 * Variant A (ADR 0031 / dex 20jkpipd): the Ratings-page Season Rank table.
 * Tier chip + numeric Rank + progress-to-next-tier bar. Admin-only state tabs
 * live on the Ratings page; this table derives state per player.
 */
export function SeasonRankTable({ eventId, seasonId, showTransition = true }: { eventId: string; seasonId: string; showTransition?: boolean }) {
  const theme = useTheme();
  const t = useT();
  const [data, setData] = useState<RankPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setData(null);
    setError(null);
    fetch(`/api/events/${eventId}/seasons/${seasonId}/rank`)
      .then(async (res) => {
        if (!alive) return;
        if (!res.ok) { setError("Season Rank is unavailable."); return; }
        setData(await res.json() as RankPayload);
      })
      .catch(() => alive && setError("Season Rank is unavailable."));
    return () => { alive = false; };
  }, [eventId, seasonId]);

  const rows = useMemo(() => {
    if (!data) return [];
    const edges = data.edges;
    return [...data.players]
      .map((p) => {
        const tier = p.tier;
        const lo = edges[tier] ?? 0;
        const hi = edges[tier + 1];
        const pct = hi === null ? 100 : Math.round(((p.display - lo) / (hi - lo)) * 100);
        return { ...p, pct, to: hi === null ? 0 : Math.max(0, hi - p.display), next: hi === null ? null : TIER_NAMES[tier + 1] };
      })
      .sort((a, b) => Number(a.provisional) - Number(b.provisional) || b.display - a.display);
  }, [data]);

  if (error) return <Alert severity="info">{error}</Alert>;
  if (!data) return <Skeleton variant="rounded" height={180} />;
  if (!data.enabled) return null;

  return (
    <Box>
      {showTransition && <TierTransitionDialog players={data.players} seasonId={seasonId} youName={data.youName} />}
      <Paper elevation={2} sx={{ borderRadius: 3, overflow: "hidden" }}>
        <Box sx={{ px: 2, pt: 2, pb: 1 }}>
          <Typography variant="h6" fontWeight={700}>{t("seasonRankTitle")}</Typography>
          <Typography variant="caption" color="text.secondary">
            {t("seasonRankSubtitle", { n: data.gamesCount })}
          </Typography>
        </Box>
        <TableContainer sx={{ overflowX: "auto" }}>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: alpha(theme.palette.primary.main, theme.palette.mode === "dark" ? 0.15 : 0.06) }}>
                <TableCell sx={{ fontWeight: 700, width: 40 }}>#</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>{t("leaderboardPlayer")}</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>{t("seasonRankTier")}</TableCell>
                <TableCell align="center" sx={{ fontWeight: 700 }}>{t("seasonRankRank")}</TableCell>
                <TableCell sx={{ fontWeight: 700, minWidth: 150, display: { xs: "none", sm: "table-cell" } }}>{t("seasonRankProgress")}</TableCell>
                <TableCell align="center" sx={{ fontWeight: 700 }}>G</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((r, i) => (
                <TableRow key={r.name} sx={{ bgcolor: r.name === data.youName ? alpha(theme.palette.primary.main, 0.08) : undefined, "&:last-child td": { borderBottom: 0 } }}>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">{r.provisional ? "—" : i + 1}</Typography>
                  </TableCell>
                  <TableCell><Typography variant="body2" fontWeight={500}>{r.name}</Typography></TableCell>
                  <TableCell>
                    {r.provisional ? (
                      <Chip label={t("seasonRankProvisional")} size="small" variant="outlined" sx={{ fontWeight: 700, color: "text.secondary" }} />
                    ) : (
                      <Chip
                        label={r.tierName ?? TIER_NAMES[r.tier]}
                        size="small"
                        sx={{ fontWeight: 700, color: TIER_COLORS[r.tier], bgcolor: alpha(TIER_COLORS[r.tier], 0.14), border: `1px solid ${alpha(TIER_COLORS[r.tier], 0.45)}` }}
                      />
                    )}
                  </TableCell>
                  <TableCell align="center">
                    {r.provisional ? (
                      <Typography variant="body2" color="text.secondary">—</Typography>
                    ) : (
                      <Chip label={r.display} size="small" variant="outlined"
                        sx={{ fontWeight: 700, minWidth: 48, color: TIER_COLORS[r.tier], borderColor: alpha(TIER_COLORS[r.tier], 0.4), bgcolor: alpha(TIER_COLORS[r.tier], 0.08) }} />
                    )}
                  </TableCell>
                  <TableCell sx={{ display: { xs: "none", sm: "table-cell" } }}>
                    {r.provisional ? (
                      <Typography variant="caption" color="text.secondary">{t("seasonRankUnlocks", { n: r.games })}</Typography>
                    ) : (
                      <Box>
                        <LinearProgress variant="determinate" value={Math.max(0, Math.min(100, r.pct))}
                          sx={{ height: 7, borderRadius: 4, bgcolor: alpha(theme.palette.text.primary, 0.08), "& .MuiLinearProgress-bar": { bgcolor: TIER_COLORS[r.tier], borderRadius: 4 } }} />
                        <Typography variant="caption" color="text.secondary">{r.next ? t("seasonRankToNext", { n: r.to, tier: r.next }) : t("seasonRankTopTier")}</Typography>
                      </Box>
                    )}
                  </TableCell>
                  <TableCell align="center"><Typography variant="body2">{r.games}</Typography></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
    </Box>
  );
}
