import React, { useState, useEffect, useCallback } from "react";
import {
  Container, Paper, Typography, Box, Stack, Chip, Button, Avatar,
  CircularProgress, alpha, useTheme,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import EmojiEventsIcon from "@mui/icons-material/EmojiEvents";
import { ThemeModeProvider } from "./ThemeModeProvider";
import { ResponsiveLayout } from "./ResponsiveLayout";
import { useT } from "~/lib/useT";

interface PlayerRating {
  name: string;
  rating: number;
  gamesPlayed: number;
  wins: number;
  draws: number;
  losses: number;
}

const PODIUM_COLORS = ["#FFD700", "#C0C0C0", "#CD7F32"] as const;

export default function RankingsPage({ eventId }: { eventId: string }) {
  const t = useT();
  const theme = useTheme();
  const [title, setTitle] = useState("");
  const [ratings, setRatings] = useState<PlayerRating[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async () => {
    const [evRes, ratRes] = await Promise.all([
      fetch(`/api/events/${eventId}`),
      fetch(`/api/events/${eventId}/ratings`),
    ]);
    if (evRes.status === 404) { setNotFound(true); setLoading(false); return; }
    const ev = await evRes.json();
    const rat = ratRes.ok ? await ratRes.json() : { data: [], nextCursor: null, hasMore: false };
    setTitle(ev.title);
    setRatings(rat.data);
    setNextCursor(rat.nextCursor);
    setHasMore(rat.hasMore);
    setLoading(false);
  }, [eventId]);

  useEffect(() => { load(); }, [load]);

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    const res = await fetch(`/api/events/${eventId}/ratings?cursor=${nextCursor}`);
    const page = await res.json();
    setRatings((prev) => [...prev, ...page.data]);
    setNextCursor(page.nextCursor);
    setHasMore(page.hasMore);
    setLoadingMore(false);
  };

  if (loading) return (
    <ThemeModeProvider>
      <ResponsiveLayout>
        <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", height: "60vh" }}>
          <CircularProgress />
        </Box>
      </ResponsiveLayout>
    </ThemeModeProvider>
  );

  if (notFound) return (
    <ThemeModeProvider>
      <ResponsiveLayout>
        <Container maxWidth="sm" sx={{ py: 8, textAlign: "center" }}>
          <Typography variant="h4" fontWeight={700} gutterBottom>{t("gameNotFound")}</Typography>
          <Button variant="contained" href="/">{t("createNewGame")}</Button>
        </Container>
      </ResponsiveLayout>
    </ThemeModeProvider>
  );

  return (
    <ThemeModeProvider>
      <ResponsiveLayout>
        <Container maxWidth="md" sx={{ py: 4 }}>
          <Stack spacing={3}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap" }}>
              <Button variant="outlined" startIcon={<ArrowBackIcon />} href={`/events/${eventId}/history`} size="small">
                {t("history")}
              </Button>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <EmojiEventsIcon color="primary" />
                <Typography variant="h5" fontWeight={700}>
                  {title} — {t("ratings")}
                </Typography>
              </Box>
            </Box>

            {ratings.length === 0 ? (
              <Paper elevation={2} sx={{ borderRadius: 3, p: 4, textAlign: "center" }}>
                <EmojiEventsIcon sx={{ fontSize: 48, color: "text.disabled", mb: 1 }} />
                <Typography variant="h6" color="text.secondary">{t("noRatings")}</Typography>
              </Paper>
            ) : (
              <Paper elevation={2} sx={{ borderRadius: 3, overflow: "hidden" }}>
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow sx={{ bgcolor: alpha(theme.palette.primary.main, theme.palette.mode === "dark" ? 0.15 : 0.06) }}>
                        <TableCell sx={{ fontWeight: 700, width: 48 }}>#</TableCell>
                        <TableCell sx={{ fontWeight: 700 }}></TableCell>
                        <TableCell align="center" sx={{ fontWeight: 700 }}>{t("rating")}</TableCell>
                        <TableCell align="center" sx={{ fontWeight: 700 }}>{t("gamesPlayed")}</TableCell>
                        <TableCell align="center" sx={{ fontWeight: 700, color: "success.main" }}>{t("wins")}</TableCell>
                        <TableCell align="center" sx={{ fontWeight: 700, color: "text.secondary" }}>{t("draws")}</TableCell>
                        <TableCell align="center" sx={{ fontWeight: 700, color: "error.main" }}>{t("losses")}</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {ratings.map((r, i) => {
                        const podiumColor = i < 3 ? PODIUM_COLORS[i] : undefined;
                        const winRate = r.gamesPlayed > 0 ? Math.round((r.wins / r.gamesPlayed) * 100) : 0;
                        return (
                          <TableRow
                            key={r.name}
                            sx={{
                              "&:last-child td": { borderBottom: 0 },
                              bgcolor: i < 3 ? alpha(podiumColor!, 0.06) : undefined,
                            }}
                          >
                            <TableCell>
                              {i < 3 ? (
                                <Avatar sx={{
                                  width: 28, height: 28, fontSize: "0.8rem", fontWeight: 700,
                                  bgcolor: alpha(podiumColor!, 0.25),
                                  color: theme.palette.text.primary,
                                }}>
                                  {i + 1}
                                </Avatar>
                              ) : (
                                <Typography variant="body2" color="text.secondary" sx={{ pl: 0.5 }}>
                                  {i + 1}
                                </Typography>
                              )}
                            </TableCell>
                            <TableCell>
                              <Typography variant="body2" fontWeight={i < 3 ? 700 : 500}>
                                {r.name}
                              </Typography>
                            </TableCell>
                            <TableCell align="center">
                              <Chip
                                label={Math.round(r.rating)}
                                size="small"
                                sx={{
                                  fontWeight: 700, fontSize: "0.8rem", minWidth: 52,
                                  bgcolor: alpha(theme.palette.primary.main, 0.1),
                                  color: theme.palette.text.primary,
                                }}
                              />
                            </TableCell>
                            <TableCell align="center">
                              <Typography variant="body2">{r.gamesPlayed}</Typography>
                            </TableCell>
                            <TableCell align="center">
                              <Typography variant="body2" color="success.main" fontWeight={600}>{r.wins}</Typography>
                            </TableCell>
                            <TableCell align="center">
                              <Typography variant="body2" color="text.secondary">{r.draws}</Typography>
                            </TableCell>
                            <TableCell align="center">
                              <Typography variant="body2" color="error.main" fontWeight={600}>{r.losses}</Typography>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Paper>
            )}

            {hasMore && (
              <Box sx={{ display: "flex", justifyContent: "center", pt: 2 }}>
                <Button variant="outlined" onClick={loadMore} disabled={loadingMore}>
                  {loadingMore ? t("loading") : t("loadMore")}
                </Button>
              </Box>
            )}
          </Stack>
        </Container>
      </ResponsiveLayout>
    </ThemeModeProvider>
  );
}
