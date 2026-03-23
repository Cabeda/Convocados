import React, { useState, useEffect, useCallback } from "react";
import {
  Container, Paper, Typography, Box, Stack, Chip, Button, Avatar,
  CircularProgress, alpha, useTheme, IconButton, Tooltip, Snackbar, Alert,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import EmojiEventsIcon from "@mui/icons-material/EmojiEvents";
import EditIcon from "@mui/icons-material/Edit";
import { ThemeModeProvider } from "./ThemeModeProvider";
import { ResponsiveLayout } from "./ResponsiveLayout";
import { useT } from "~/lib/useT";

interface PlayerRating {
  name: string;
  rating: number;
  initialRating: number | null;
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
  const [canEdit, setCanEdit] = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  const [snack, setSnack] = useState<{ msg: string; severity: "success" | "error" } | null>(null);

  // Edit dialog state
  const [editPlayer, setEditPlayer] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);

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
    // Owner or admin can edit ratings (only if allowManualRating is enabled)
    const isOwner = ev.ownerId && ev.ownerId === ev._currentUserId;
    const hasEditPermission = isOwner || ev.isAdmin || !ev.ownerId;
    setCanEdit(hasEditPermission && !!ev.allowManualRating);
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

  const handleRecalculate = async () => {
    setRecalculating(true);
    try {
      const res = await fetch(`/api/events/${eventId}/ratings/recalculate`, { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setSnack({ msg: t("ratingsRecalculated", { n: data.gamesProcessed }), severity: "success" });
        // Reload ratings
        const ratRes = await fetch(`/api/events/${eventId}/ratings`);
        const rat = ratRes.ok ? await ratRes.json() : { data: [], nextCursor: null, hasMore: false };
        setRatings(rat.data);
        setNextCursor(rat.nextCursor);
        setHasMore(rat.hasMore);
      } else {
        setSnack({ msg: data.error || "Error", severity: "error" });
      }
    } catch {
      setSnack({ msg: "Error", severity: "error" });
    }
    setRecalculating(false);
  };

  const openEditDialog = (player: PlayerRating) => {
    setEditPlayer(player.name);
    setEditValue(String(player.initialRating ?? Math.round(player.rating)));
  };

  const handleSaveInitialRating = async () => {
    if (!editPlayer) return;
    const val = parseInt(editValue, 10);
    if (isNaN(val) || val < 500 || val > 1500) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/events/${eventId}/ratings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editPlayer, initialRating: val }),
      });
      const data = await res.json();
      if (res.ok) {
        const msg = data.needsRecalculate ? t("initialRatingNeedsRecalculate") : t("initialRatingSaved");
        setSnack({ msg, severity: "success" });
        // Update local state
        setRatings((prev) => prev.map((r) =>
          r.name === editPlayer
            ? { ...r, rating: data.rating, initialRating: data.initialRating }
            : r
        ));
        setEditPlayer(null);
      } else {
        setSnack({ msg: data.error || "Error", severity: "error" });
      }
    } catch {
      setSnack({ msg: "Error", severity: "error" });
    }
    setSaving(false);
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

  const editError = editValue !== "" && (isNaN(parseInt(editValue, 10)) || parseInt(editValue, 10) < 500 || parseInt(editValue, 10) > 1500);

  return (
    <ThemeModeProvider>
      <ResponsiveLayout>
        <Container maxWidth="md" sx={{ py: 4 }}>
          <Stack spacing={3}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap" }}>
              <Button variant="outlined" startIcon={<ArrowBackIcon />} href={`/events/${eventId}/history`} size="small">
                {t("history")}
              </Button>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, flex: 1 }}>
                <EmojiEventsIcon color="primary" />
                <Typography variant="h5" fontWeight={700}>
                  {title} — {t("ratings")}
                </Typography>
              </Box>
              {canEdit && (
                <Button
                  variant="outlined"
                  size="small"
                  onClick={handleRecalculate}
                  disabled={recalculating}
                >
                  {recalculating ? t("recalculating") : t("recalculateRatings")}
                </Button>
              )}
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
                        {canEdit && <TableCell sx={{ width: 48 }} />}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {ratings.map((r, i) => {
                        const podiumColor = i < 3 ? PODIUM_COLORS[i] : undefined;
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
                              <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 0.5 }}>
                                <Chip
                                  label={Math.round(r.rating)}
                                  size="small"
                                  sx={{
                                    fontWeight: 700, fontSize: "0.8rem", minWidth: 52,
                                    bgcolor: alpha(theme.palette.primary.main, 0.1),
                                    color: theme.palette.text.primary,
                                  }}
                                />
                                {r.initialRating != null && (
                                  <Tooltip title={`${t("initialRating")}: ${r.initialRating}`}>
                                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: "0.65rem" }}>
                                      ({r.initialRating})
                                    </Typography>
                                  </Tooltip>
                                )}
                              </Box>
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
                            {canEdit && (
                              <TableCell align="center" sx={{ px: 0.5 }}>
                                <Tooltip title={t("setInitialRating")}>
                                  <IconButton size="small" onClick={() => openEditDialog(r)}>
                                    <EditIcon sx={{ fontSize: 16 }} />
                                  </IconButton>
                                </Tooltip>
                              </TableCell>
                            )}
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

        {/* Edit initial rating dialog */}
        <Dialog open={!!editPlayer} onClose={() => setEditPlayer(null)} maxWidth="xs" fullWidth>
          <DialogTitle>{t("setInitialRating")}</DialogTitle>
          <DialogContent>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {editPlayer} — {t("initialRatingHelper")}
            </Typography>
            <TextField
              autoFocus
              fullWidth
              type="number"
              label={t("initialRating")}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              inputProps={{ min: 500, max: 1500, step: 50 }}
              error={!!editError}
              helperText={editError ? "500–1500" : undefined}
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setEditPlayer(null)}>{t("cancel")}</Button>
            <Button
              variant="contained"
              onClick={handleSaveInitialRating}
              disabled={saving || !!editError || editValue === ""}
            >
              {saving ? t("loading") : t("saveProfile")}
            </Button>
          </DialogActions>
        </Dialog>

        {/* Snackbar */}
        <Snackbar open={!!snack} autoHideDuration={4000} onClose={() => setSnack(null)}>
          <Alert severity={snack?.severity} onClose={() => setSnack(null)} variant="filled">
            {snack?.msg}
          </Alert>
        </Snackbar>
      </ResponsiveLayout>
    </ThemeModeProvider>
  );
}
