import React, { useState, useEffect } from "react";
import {
  Container, Paper, Typography, Stack, Box, Button, Chip,
  CircularProgress, Alert, alpha, useTheme,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
} from "@mui/material";
import SportsIcon from "@mui/icons-material/Sports";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import { ThemeModeProvider } from "./ThemeModeProvider";
import { ResponsiveLayout } from "./ResponsiveLayout";
import { useT } from "~/lib/useT";
import { useSession } from "~/lib/auth.client";

interface EventStats {
  eventId: string;
  eventTitle: string;
  sport: string;
  rating: number;
  gamesPlayed: number;
  wins: number;
  draws: number;
  losses: number;
  winRate: number;
  attendance: {
    gamesPlayed: number;
    totalGames: number;
    attendanceRate: number;
    currentStreak: number;
  } | null;
}

interface StatsData {
  summary: {
    totalGames: number;
    totalWins: number;
    totalDraws: number;
    totalLosses: number;
    winRate: number;
    avgRating: number;
    bestRating: number;
    eventsPlayed: number;
  };
  events: EventStats[];
}

function StatCard({ label, value, color }: { label: string; value: string | number; color?: string }) {
  const theme = useTheme();
  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2, borderRadius: 2, textAlign: "center", flex: "1 1 120px", minWidth: 100,
        bgcolor: color ? alpha(color, theme.palette.mode === "dark" ? 0.1 : 0.04) : undefined,
      }}
    >
      <Typography variant="h5" fontWeight={700} color={color ?? "text.primary"}>
        {value}
      </Typography>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
    </Paper>
  );
}

function RatingBar({ rating, maxRating }: { rating: number; maxRating: number }) {
  const theme = useTheme();
  const pct = maxRating > 0 ? Math.min((rating / maxRating) * 100, 100) : 0;
  const color = rating >= 1200
    ? theme.palette.success.main
    : rating >= 1000
      ? theme.palette.primary.main
      : theme.palette.warning.main;

  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, width: "100%" }}>
      <Box sx={{ flex: 1, height: 8, borderRadius: 4, bgcolor: alpha(color, 0.15) }}>
        <Box sx={{ width: `${pct}%`, height: "100%", borderRadius: 4, bgcolor: color, transition: "width 0.3s" }} />
      </Box>
      <Typography variant="body2" fontWeight={700} sx={{ minWidth: 40, textAlign: "right" }}>
        {rating}
      </Typography>
    </Box>
  );
}

export default function PlayerStatsPage() {
  const t = useT();
  const theme = useTheme();
  const { data: session, isPending: sessionLoading } = useSession();
  const [data, setData] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!session?.user) return;
    fetch("/api/me/stats")
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => { setError(true); setLoading(false); });
  }, [session?.user]);

  if (sessionLoading) {
    return (
      <ThemeModeProvider>
        <ResponsiveLayout>
          <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
            <CircularProgress />
          </Box>
        </ResponsiveLayout>
      </ThemeModeProvider>
    );
  }

  if (!session?.user) {
    return (
      <ThemeModeProvider>
        <ResponsiveLayout>
          <Container maxWidth="sm" sx={{ py: 8, textAlign: "center" }}>
            <Typography variant="h5" fontWeight={700} gutterBottom>
              {t("playerStats")}
            </Typography>
            <Button variant="contained" href="/auth/signin" sx={{ mt: 2 }}>
              {t("signIn")}
            </Button>
          </Container>
        </ResponsiveLayout>
      </ThemeModeProvider>
    );
  }

  return (
    <ThemeModeProvider>
      <ResponsiveLayout>
        <Container maxWidth="md" sx={{ py: 4 }}>
          <Stack spacing={3}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <TrendingUpIcon color="primary" />
              <Typography variant="h4" fontWeight={700}>{t("playerStats")}</Typography>
            </Box>
            <Typography variant="body2" color="text.secondary">{t("playerStatsDesc")}</Typography>

            {loading ? (
              <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
                <CircularProgress />
              </Box>
            ) : error ? (
              <Alert severity="error">{t("somethingWentWrong")}</Alert>
            ) : !data || data.summary.totalGames === 0 ? (
              <Paper elevation={2} sx={{ borderRadius: 3, p: 4, textAlign: "center" }}>
                <SportsIcon sx={{ fontSize: 48, color: "text.disabled", mb: 1 }} />
                <Typography variant="h6" color="text.secondary">{t("statsNoData")}</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>{t("statsNoDataDesc")}</Typography>
              </Paper>
            ) : (
              <>
                {/* Summary cards */}
                <Paper elevation={2} sx={{ borderRadius: 3, p: { xs: 2, sm: 3 } }}>
                  <Typography variant="subtitle1" fontWeight={600} gutterBottom>{t("statsOverview")}</Typography>
                  <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1.5 }}>
                    <StatCard label={t("statsTotalGames")} value={data.summary.totalGames} />
                    <StatCard label={t("statsWins")} value={data.summary.totalWins} color={theme.palette.success.main} />
                    <StatCard label={t("statsDraws")} value={data.summary.totalDraws} />
                    <StatCard label={t("statsLosses")} value={data.summary.totalLosses} color={theme.palette.error.main} />
                    <StatCard label={t("statsWinRate")} value={`${Math.round(data.summary.winRate * 100)}%`} color={theme.palette.primary.main} />
                    <StatCard label={t("statsAvgRating")} value={data.summary.avgRating} />
                    <StatCard label={t("statsBestRating")} value={data.summary.bestRating} color={theme.palette.success.main} />
                    <StatCard label={t("statsEventsPlayed")} value={data.summary.eventsPlayed} />
                  </Box>
                </Paper>

                {/* W/D/L ratio bar */}
                <Paper elevation={2} sx={{ borderRadius: 3, p: { xs: 2, sm: 3 } }}>
                  <Box sx={{ display: "flex", height: 12, borderRadius: 6, overflow: "hidden" }}>
                    {data.summary.totalWins > 0 && (
                      <Box sx={{
                        flex: data.summary.totalWins,
                        bgcolor: "success.main",
                        transition: "flex 0.3s",
                      }} />
                    )}
                    {data.summary.totalDraws > 0 && (
                      <Box sx={{
                        flex: data.summary.totalDraws,
                        bgcolor: "grey.400",
                        transition: "flex 0.3s",
                      }} />
                    )}
                    {data.summary.totalLosses > 0 && (
                      <Box sx={{
                        flex: data.summary.totalLosses,
                        bgcolor: "error.main",
                        transition: "flex 0.3s",
                      }} />
                    )}
                  </Box>
                  <Stack direction="row" spacing={2} sx={{ mt: 1, justifyContent: "center" }}>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                      <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: "success.main" }} />
                      <Typography variant="caption">{t("statsWins")} ({data.summary.totalWins})</Typography>
                    </Box>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                      <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: "grey.400" }} />
                      <Typography variant="caption">{t("statsDraws")} ({data.summary.totalDraws})</Typography>
                    </Box>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                      <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: "error.main" }} />
                      <Typography variant="caption">{t("statsLosses")} ({data.summary.totalLosses})</Typography>
                    </Box>
                  </Stack>
                </Paper>

                {/* Per-event breakdown */}
                <Paper elevation={2} sx={{ borderRadius: 3, overflow: "hidden" }}>
                  <Box sx={{ p: { xs: 2, sm: 3 }, pb: 0 }}>
                    <Typography variant="subtitle1" fontWeight={600}>{t("statsPerEvent")}</Typography>
                  </Box>
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow sx={{ bgcolor: alpha(theme.palette.primary.main, theme.palette.mode === "dark" ? 0.15 : 0.06) }}>
                          <TableCell sx={{ fontWeight: 700 }}></TableCell>
                          <TableCell align="center" sx={{ fontWeight: 700 }}>{t("rating")}</TableCell>
                          <TableCell align="center" sx={{ fontWeight: 700 }}>{t("gamesPlayed")}</TableCell>
                          <TableCell align="center" sx={{ fontWeight: 700, color: "success.main" }}>{t("wins")}</TableCell>
                          <TableCell align="center" sx={{ fontWeight: 700 }}>{t("draws")}</TableCell>
                          <TableCell align="center" sx={{ fontWeight: 700, color: "error.main" }}>{t("losses")}</TableCell>
                          <TableCell align="center" sx={{ fontWeight: 700 }}>{t("statsAttendanceRate")}</TableCell>
                          <TableCell sx={{ width: 48 }} />
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {data.events.map((ev) => (
                          <TableRow key={ev.eventId} sx={{ "&:last-child td": { borderBottom: 0 } }}>
                            <TableCell>
                              <Stack spacing={0.5}>
                                <Typography variant="body2" fontWeight={600}>{ev.eventTitle}</Typography>
                                <RatingBar rating={ev.rating} maxRating={data.summary.bestRating > 0 ? data.summary.bestRating * 1.1 : 1500} />
                              </Stack>
                            </TableCell>
                            <TableCell align="center">
                              <Chip
                                label={ev.rating}
                                size="small"
                                sx={{
                                  fontWeight: 700, fontSize: "0.8rem", minWidth: 48,
                                  bgcolor: alpha(theme.palette.primary.main, 0.1),
                                  color: theme.palette.text.primary,
                                }}
                              />
                            </TableCell>
                            <TableCell align="center">
                              <Typography variant="body2">{ev.gamesPlayed}</Typography>
                            </TableCell>
                            <TableCell align="center">
                              <Typography variant="body2" color="success.main" fontWeight={600}>{ev.wins}</Typography>
                            </TableCell>
                            <TableCell align="center">
                              <Typography variant="body2" color="text.secondary">{ev.draws}</Typography>
                            </TableCell>
                            <TableCell align="center">
                              <Typography variant="body2" color="error.main" fontWeight={600}>{ev.losses}</Typography>
                            </TableCell>
                            <TableCell align="center">
                              {ev.attendance ? (
                                <Stack spacing={0.5} alignItems="center">
                                  <Typography variant="body2">
                                    {Math.round(ev.attendance.attendanceRate * 100)}%
                                  </Typography>
                                  {ev.attendance.currentStreak > 0 && (
                                    <Chip
                                      label={`${ev.attendance.currentStreak} ${t("statsCurrentStreak").toLowerCase()}`}
                                      size="small"
                                      variant="outlined"
                                      sx={{ fontSize: "0.65rem" }}
                                    />
                                  )}
                                </Stack>
                              ) : (
                                <Typography variant="body2" color="text.secondary">—</Typography>
                              )}
                            </TableCell>
                            <TableCell>
                              <Button
                                href={`/events/${ev.eventId}`}
                                size="small"
                                sx={{ minWidth: 0, p: 0.5 }}
                                aria-label={t("statsViewEvent")}
                              >
                                <OpenInNewIcon fontSize="small" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Paper>
              </>
            )}
          </Stack>
        </Container>
      </ResponsiveLayout>
    </ThemeModeProvider>
  );
}
