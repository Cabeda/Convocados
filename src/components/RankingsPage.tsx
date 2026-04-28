import React, { useState, useEffect, useCallback } from "react";
import {
  Container, Paper, Typography, Box, Stack, Chip, Button, Avatar,
  CircularProgress, alpha, useTheme, IconButton, Tooltip, Snackbar, Alert,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, TextField,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import EmojiEventsIcon from "@mui/icons-material/EmojiEvents";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import HowToRegIcon from "@mui/icons-material/HowToReg";
import { ThemeModeProvider } from "./ThemeModeProvider";
import { ResponsiveLayout } from "./ResponsiveLayout";
import { useT } from "~/lib/useT";
import { useSession } from "~/lib/auth.client";

interface PlayerRating {
  name: string;
  rating: number;
  initialRating: number | null;
  gamesPlayed: number;
  wins: number;
  draws: number;
  losses: number;
  mvpAwards: number;
}

interface EventPlayer {
  id: string;
  name: string;
  userId: string | null;
}

interface TableRowData {
  name: string;
  rating: number | null;
  initialRating: number | null;
  gamesPlayed: number;
  wins: number;
  draws: number;
  losses: number;
  mvpAwards: number;
  playerId: string | null;
  userId: string | null;
}

const PODIUM_COLORS = ["#FFD700", "#C0C0C0", "#CD7F32"] as const;

export default function RankingsPage({ eventId }: { eventId: string }) {
  const t = useT();
  const theme = useTheme();
  const { data: session } = useSession();
  const [title, setTitle] = useState("");
  const [ratings, setRatings] = useState<PlayerRating[]>([]);
  const [players, setPlayers] = useState<EventPlayer[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [canManage, setCanManage] = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  const [snack, setSnack] = useState<{ msg: string; severity: "success" | "error" } | null>(null);

  // Edit dialog state
  const [editPlayer, setEditPlayer] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);

  // Purge player state
  const [purgeTarget, setPurgeTarget] = useState<string | null>(null);
  const [purging, setPurging] = useState(false);

  // Claim player state
  const [claimTarget, setClaimTarget] = useState<{ id: string; name: string } | null>(null);
  const [claiming, setClaiming] = useState(false);

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
    setPlayers((ev.players ?? []).map((p: any) => ({ id: p.id, name: p.name, userId: p.userId ?? null })));
    const isOwner = !!(session?.user && ev.ownerId && session.user.id === ev.ownerId);
    const hasEditPermission = isOwner || ev.isAdmin || !ev.ownerId;
    setCanEdit(hasEditPermission && !!ev.allowManualRating);
    setCanManage(hasEditPermission);
    setLoading(false);
  }, [eventId, session]);

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

  const handlePurgePlayer = async () => {
    if (!purgeTarget) return;
    setPurging(true);
    try {
      const res = await fetch(`/api/events/${eventId}/purge-player`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: purgeTarget }),
      });
      if (res.ok) {
        setSnack({ msg: t("purgePlayerSuccess"), severity: "success" });
        setRatings((prev) => prev.filter((r) => r.name !== purgeTarget));
        setPurgeTarget(null);
      } else {
        setSnack({ msg: t("purgePlayerError"), severity: "error" });
      }
    } catch {
      setSnack({ msg: t("purgePlayerError"), severity: "error" });
    }
    setPurging(false);
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

  const handleClaimPlayer = async () => {
    if (!claimTarget) return;
    setClaiming(true);
    try {
      const res = await fetch(`/api/events/${eventId}/claim-player`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId: claimTarget.id }),
      });
      if (res.ok) {
        setSnack({ msg: t("claimPlayerSuccess"), severity: "success" });
        setClaimTarget(null);
        load();
      } else {
        const data = await res.json();
        setSnack({ msg: data.error || "Error", severity: "error" });
        setClaimTarget(null);
      }
    } catch {
      setSnack({ msg: "Error", severity: "error" });
      setClaimTarget(null);
    }
    setClaiming(false);
  };

  const isAuthenticated = !!session?.user;
  const userHasLinkedPlayer = isAuthenticated && players.some((p) => p.userId === session!.user!.id);
  const canClaimPlayer = isAuthenticated && !userHasLinkedPlayer;

  const playerByName = new Map(players.map((p) => [p.name, p]));

  const tableRows: TableRowData[] = (() => {
    const _ratingByName = new Map(ratings.map((r) => [r.name, r]));
    const rows: TableRowData[] = [];
    const seen = new Set<string>();

    for (const r of ratings) {
      const p = playerByName.get(r.name);
      rows.push({
        name: r.name,
        rating: r.rating,
        initialRating: r.initialRating,
        gamesPlayed: r.gamesPlayed,
        wins: r.wins,
        draws: r.draws,
        losses: r.losses,
        mvpAwards: r.mvpAwards ?? 0,
        playerId: p?.id ?? null,
        userId: p?.userId ?? null,
      });
      seen.add(r.name.toLowerCase());
    }

    for (const p of players) {
      if (!seen.has(p.name.toLowerCase())) {
        rows.push({
          name: p.name,
          rating: null,
          initialRating: null,
          gamesPlayed: 0,
          wins: 0,
          draws: 0,
          losses: 0,
          mvpAwards: 0,
          playerId: p.id,
          userId: p.userId,
        });
      }
    }

    return rows;
  })();

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
  const showActionsCol = canEdit || canManage || canClaimPlayer;

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

            {tableRows.length === 0 ? (
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
                        <TableCell align="center" sx={{ fontWeight: 700, color: "warning.main" }}>🏆</TableCell>
                        {showActionsCol && <TableCell sx={{ width: 110 }} />}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {tableRows.map((r, i) => {
                        const podiumColor = i < 3 && r.rating !== null ? PODIUM_COLORS[i] : undefined;
                        const isUnclaimed = canClaimPlayer && r.playerId && !r.userId;
                        return (
                          <TableRow
                            key={r.name}
                            sx={{
                              "&:last-child td": { borderBottom: 0 },
                              bgcolor: podiumColor ? alpha(podiumColor, 0.06) : undefined,
                            }}
                          >
                            <TableCell>
                              {podiumColor ? (
                                <Avatar sx={{
                                  width: 28, height: 28, fontSize: "0.8rem", fontWeight: 700,
                                  bgcolor: alpha(podiumColor, 0.25),
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
                              <Typography variant="body2" fontWeight={podiumColor ? 700 : 500}>
                                {r.name}
                              </Typography>
                            </TableCell>
                            <TableCell align="center">
                              <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 0.5 }}>
                                {r.rating !== null ? (
                                  <Chip
                                    label={Math.round(r.rating)}
                                    size="small"
                                    variant="outlined"
                                    sx={{
                                      fontWeight: 700, fontSize: "0.8rem", minWidth: 52,
                                      bgcolor: alpha(theme.palette.primary.main, 0.1),
                                      borderColor: alpha(theme.palette.primary.main, 0.2),
                                    }}
                                  />
                                ) : (
                                  <Typography variant="body2" color="text.secondary">—</Typography>
                                )}
                                {r.initialRating !== null && (
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
                            <TableCell align="center">
                              {r.mvpAwards > 0 && (
                                <Typography variant="body2" color="warning.main" fontWeight={700}>{r.mvpAwards}</Typography>
                              )}
                            </TableCell>
                            {showActionsCol && (
                              <TableCell align="right" sx={{ px: 0.5 }}>
                                <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.25 }}>
                                  {isUnclaimed && r.playerId && (
                                    <Tooltip title={t("claimPlayer")}>
                                      <IconButton size="small" color="primary" onClick={() => setClaimTarget({ id: r.playerId!, name: r.name })}>
                                        <HowToRegIcon sx={{ fontSize: 20 }} />
                                      </IconButton>
                                    </Tooltip>
                                  )}
                                  {canEdit && r.rating !== null && (
                                    <Tooltip title={t("setInitialRating")}>
                                      <IconButton size="small" onClick={() => openEditDialog(r as PlayerRating)}>
                                        <EditIcon sx={{ fontSize: 20 }} />
                                      </IconButton>
                                    </Tooltip>
                                  )}
                                  {canManage && (
                                    <Tooltip title={t("purgePlayer")}>
                                      <IconButton size="small" color="error" sx={{ ml: 0.5 }} onClick={() => setPurgeTarget(r.name)}>
                                        <DeleteIcon sx={{ fontSize: 20 }} />
                                      </IconButton>
                                    </Tooltip>
                                  )}
                                </Box>
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

        {/* Claim player confirmation dialog */}
        <Dialog open={!!claimTarget} onClose={() => !claiming && setClaimTarget(null)} maxWidth="xs" fullWidth>
          <DialogTitle>{t("claimPlayerTitle")}</DialogTitle>
          <DialogContent>
            <DialogContentText>
              {t("claimPlayerConfirmDesc", { name: claimTarget?.name ?? "" })}
            </DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setClaimTarget(null)} disabled={claiming}>{t("cancel")}</Button>
            <Button variant="contained" onClick={handleClaimPlayer} disabled={claiming}>
              {t("claimPlayer")}
            </Button>
          </DialogActions>
        </Dialog>

        {/* Purge player confirmation dialog */}
        <Dialog open={!!purgeTarget} onClose={() => !purging && setPurgeTarget(null)} maxWidth="xs" fullWidth>
          <DialogTitle>{t("purgePlayer")}</DialogTitle>
          <DialogContent>
            <Typography variant="body2">
              {t("purgePlayerConfirm", { name: purgeTarget ?? "" })}
            </Typography>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setPurgeTarget(null)} disabled={purging}>{t("cancel")}</Button>
            <Button color="error" variant="contained" onClick={handlePurgePlayer} disabled={purging}>
              {purging ? t("deleting") : t("purgePlayer")}
            </Button>
          </DialogActions>
        </Dialog>

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
