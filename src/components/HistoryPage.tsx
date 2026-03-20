import React, { useState, useEffect, useCallback } from "react";
import {
  Container, Paper, Typography, Box, Stack, Chip, Button, Divider,
  CircularProgress, Alert, TextField,
  alpha, useTheme, IconButton, Tooltip, Grid2,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import HistoryIcon from "@mui/icons-material/History";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CancelIcon from "@mui/icons-material/Cancel";
import LockIcon from "@mui/icons-material/Lock";
import SaveIcon from "@mui/icons-material/Save";
import SportsIcon from "@mui/icons-material/Sports";
import PersonAddIcon from "@mui/icons-material/PersonAdd";
import EmojiEventsIcon from "@mui/icons-material/EmojiEvents";
import PaymentIcon from "@mui/icons-material/Payment";
import { ThemeModeProvider } from "./ThemeModeProvider";
import { ResponsiveLayout } from "./ResponsiveLayout";
import { useT } from "~/lib/useT";
import { detectLocale } from "~/lib/i18n";

interface TeamSnapshot {
  team: string;
  players: { name: string; order: number }[];
}

interface PaymentSnapshotEntry {
  playerName: string;
  amount: number;
  status: "paid" | "pending" | "exempt";
  method?: string | null;
}

interface HistoryEntry {
  id: string;
  dateTime: string;
  status: "played" | "cancelled";
  scoreOne: number | null;
  scoreTwo: number | null;
  teamOneName: string;
  teamTwoName: string;
  teamsSnapshot: string | null;
  paymentsSnapshot: string | null;
  editableUntil: string;
  editable: boolean;
  eloUpdates?: { name: string; delta: number }[] | null;
}

/** Reusable section wrapper with optional title + icon */
function Section({ icon, title, children, action }: {
  icon?: React.ReactNode;
  title?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <Box>
      {title && (
        <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between" sx={{ mb: 1.5 }}>
          <Stack direction="row" spacing={0.75} alignItems="center">
            {icon}
            <Typography variant="subtitle2" fontWeight={700} textTransform="uppercase" letterSpacing={0.5} color="text.secondary">
              {title}
            </Typography>
          </Stack>
          {action}
        </Stack>
      )}
      {children}
    </Box>
  );
}

function HistoryCardFull({
  entry,
  eventId,
  onUpdate,
}: {
  entry: HistoryEntry;
  eventId: string;
  onUpdate: (updated: HistoryEntry) => void;
}) {
  const t = useT();
  const locale = detectLocale();
  const theme = useTheme();
  const [scoreOne, setScoreOne] = useState(entry.scoreOne !== null ? String(entry.scoreOne) : "");
  const [scoreTwo, setScoreTwo] = useState(entry.scoreTwo !== null ? String(entry.scoreTwo) : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const teams: TeamSnapshot[] = entry.teamsSnapshot ? JSON.parse(entry.teamsSnapshot) : [];
  const [editableTeams, setEditableTeams] = useState<TeamSnapshot[]>(teams);
  const [newPlayerInputs, setNewPlayerInputs] = useState<Record<number, string>>({});
  const [teamsDirty, setTeamsDirty] = useState(false);

  const payments: PaymentSnapshotEntry[] = entry.paymentsSnapshot ? JSON.parse(entry.paymentsSnapshot) : [];
  const [editablePayments, setEditablePayments] = useState<PaymentSnapshotEntry[]>(payments);
  const [paymentsDirty, setPaymentsDirty] = useState(false);
  const date = new Date(entry.dateTime);
  const editableUntil = new Date(entry.editableUntil);
  const isCancelled = entry.status === "cancelled";

  const patch = async (data: object) => {
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/events/${eventId}/history/${entry.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const json = await res.json();
    setSaving(false);
    if (!res.ok) { setError(json.error); return; }
    onUpdate(json);
  };

  const handleSaveScore = () => {
    const s1 = scoreOne === "" ? null : parseInt(scoreOne, 10);
    const s2 = scoreTwo === "" ? null : parseInt(scoreTwo, 10);
    patch({ scoreOne: isNaN(s1 as number) ? null : s1, scoreTwo: isNaN(s2 as number) ? null : s2 });
  };

  const removePlayerFromTeam = (teamIdx: number, playerName: string) => {
    setEditableTeams((prev) => prev.map((t, i) => {
      if (i !== teamIdx) return t;
      const filtered = t.players.filter((p) => p.name !== playerName);
      return { ...t, players: filtered.map((p, j) => ({ ...p, order: j })) };
    }));
    setTeamsDirty(true);
  };

  const addPlayerToTeam = (teamIdx: number) => {
    const name = (newPlayerInputs[teamIdx] ?? "").trim();
    if (!name) return;
    const allNames = editableTeams.flatMap((t) => t.players.map((p) => p.name.toLowerCase()));
    if (allNames.includes(name.toLowerCase())) return;
    setEditableTeams((prev) => prev.map((t, i) => {
      if (i !== teamIdx) return t;
      return { ...t, players: [...t.players, { name, order: t.players.length }] };
    }));
    setNewPlayerInputs((prev) => ({ ...prev, [teamIdx]: "" }));
    setTeamsDirty(true);
  };

  const handleSaveTeams = () => {
    patch({ teamsSnapshot: editableTeams });
    setTeamsDirty(false);
  };

  const cyclePaymentStatus = (idx: number) => {
    const order: Array<"paid" | "pending" | "exempt"> = ["pending", "paid", "exempt"];
    setEditablePayments((prev) =>
      prev.map((p, i) => {
        if (i !== idx) return p;
        const next = order[(order.indexOf(p.status) + 1) % order.length];
        return { ...p, status: next };
      }),
    );
    setPaymentsDirty(true);
  };

  const handleSavePayments = () => {
    patch({ paymentsSnapshot: editablePayments });
    setPaymentsDirty(false);
  };

  const localeStr = locale === "pt" ? "pt-PT" : "en-GB";

  return (
    <Paper
      elevation={0}
      sx={{
        borderRadius: 4,
        overflow: "hidden",
        opacity: isCancelled ? 0.7 : 1,
        border: `1px solid ${alpha(theme.palette.divider, 0.12)}`,
        transition: "box-shadow 0.2s",
        "&:hover": { boxShadow: theme.shadows[4] },
      }}
    >
      {/* ── Header ── */}
      <Box sx={{
        px: 3, py: 2.5,
        background: `linear-gradient(135deg, ${alpha(
          isCancelled ? theme.palette.error.main : theme.palette.success.main, 0.08,
        )}, ${alpha(theme.palette.background.paper, 0)})`,
        display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 1,
      }}>
        <Box>
          <Typography variant="h6" fontWeight={700} sx={{ lineHeight: 1.3 }}>
            {date.toLocaleDateString(localeStr, {
              weekday: "long", day: "numeric", month: "long", year: "numeric",
            })}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
            {date.toLocaleTimeString(localeStr, { hour: "2-digit", minute: "2-digit" })}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} alignItems="center">
          <Chip
            icon={isCancelled ? <CancelIcon /> : <CheckCircleIcon />}
            label={isCancelled ? t("statusCancelled") : t("statusPlayed")}
            color={isCancelled ? "error" : "success"}
            size="small"
            sx={{ fontWeight: 600 }}
          />
          {!entry.editable && (
            <Tooltip title={t("notEditable")}>
              <LockIcon fontSize="small" color="disabled" />
            </Tooltip>
          )}
        </Stack>
      </Box>

      <Stack spacing={0} divider={<Divider sx={{ mx: 3 }} />}>
        {error && (
          <Box sx={{ px: 3, pt: 2 }}>
            <Alert severity="error" onClose={() => setError(null)} sx={{ borderRadius: 2 }}>{error}</Alert>
          </Box>
        )}

        {/* ── Score ── */}
        {!isCancelled && (
          <Box sx={{ px: 3, py: 2.5 }}>
            <Section title={t("score")} action={
              entry.editable ? (
                <Button variant="contained" size="small" disableElevation startIcon={<SaveIcon />}
                  onClick={handleSaveScore} disabled={saving}
                  sx={{ borderRadius: 2, textTransform: "none", fontWeight: 600 }}>
                  {t("saveScore")}
                </Button>
              ) : undefined
            }>
              <Stack direction="row" spacing={2} alignItems="center" justifyContent="center"
                sx={{
                  py: 2, px: 3, borderRadius: 3,
                  backgroundColor: alpha(theme.palette.action.hover, 0.04),
                }}>
                {/* Team 1 */}
                <Stack alignItems="center" spacing={0.5} sx={{ flex: 1 }}>
                  <Typography variant="caption" fontWeight={600} color="text.secondary" noWrap>
                    {entry.teamOneName}
                  </Typography>
                  {entry.editable ? (
                    <TextField
                      size="small" type="number" value={scoreOne}
                      onChange={(e) => setScoreOne(e.target.value)}
                      inputProps={{ min: 0, max: 99, style: { textAlign: "center", fontWeight: 700, fontSize: "2rem" } }}
                      sx={{ width: 80, "& .MuiOutlinedInput-root": { borderRadius: 2 } }}
                    />
                  ) : (
                    <Typography variant="h3" fontWeight={800} color="text.primary">
                      {entry.scoreOne !== null ? entry.scoreOne : "—"}
                    </Typography>
                  )}
                </Stack>

                <Typography variant="h4" color="text.disabled" fontWeight={300} sx={{ px: 1 }}>:</Typography>

                {/* Team 2 */}
                <Stack alignItems="center" spacing={0.5} sx={{ flex: 1 }}>
                  <Typography variant="caption" fontWeight={600} color="text.secondary" noWrap>
                    {entry.teamTwoName}
                  </Typography>
                  {entry.editable ? (
                    <TextField
                      size="small" type="number" value={scoreTwo}
                      onChange={(e) => setScoreTwo(e.target.value)}
                      inputProps={{ min: 0, max: 99, style: { textAlign: "center", fontWeight: 700, fontSize: "2rem" } }}
                      sx={{ width: 80, "& .MuiOutlinedInput-root": { borderRadius: 2 } }}
                    />
                  ) : (
                    <Typography variant="h3" fontWeight={800} color="text.primary">
                      {entry.scoreTwo !== null ? entry.scoreTwo : "—"}
                    </Typography>
                  )}
                </Stack>
              </Stack>
            </Section>
          </Box>
        )}

        {/* ── Teams ── */}
        {teams.length > 0 && !isCancelled && (
          <Box sx={{ px: 3, py: 2.5 }}>
            <Section
              title={t("teams")}
              icon={<SportsIcon fontSize="small" sx={{ color: "text.secondary" }} />}
              action={
                entry.editable && teamsDirty ? (
                  <Button variant="contained" size="small" disableElevation startIcon={<SaveIcon />}
                    onClick={handleSaveTeams} disabled={saving}
                    sx={{ borderRadius: 2, textTransform: "none", fontWeight: 600 }}>
                    {t("saveTeams")}
                  </Button>
                ) : undefined
              }
            >
              <Grid2 container spacing={2}>
                {(entry.editable ? editableTeams : teams).map((team, teamIdx) => (
                  <Grid2 key={team.team} size={{ xs: 12, sm: 6 }}>
                    <Box sx={{
                      p: 2, borderRadius: 3,
                      backgroundColor: alpha(theme.palette.action.hover, 0.04),
                      border: `1px solid ${alpha(theme.palette.divider, 0.08)}`,
                    }}>
                      <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>{team.team}</Typography>
                      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
                        {team.players.map((p) => {
                          const elo = entry.eloUpdates?.find((e) => e.name === p.name);
                          const deltaLabel = elo ? (elo.delta >= 0 ? `+${elo.delta}` : `${elo.delta}`) : null;
                          return (
                            <Chip
                              key={p.name} size="small" variant="outlined"
                              label={
                                deltaLabel ? (
                                  <span>
                                    {p.name}{" "}
                                    <span style={{
                                      color: elo!.delta > 0 ? theme.palette.success.main
                                        : elo!.delta < 0 ? theme.palette.error.main
                                        : theme.palette.text.secondary,
                                      fontWeight: 700, fontSize: "0.75rem",
                                    }}>
                                      {deltaLabel}
                                    </span>
                                  </span>
                                ) : p.name
                              }
                              onDelete={entry.editable ? () => removePlayerFromTeam(teamIdx, p.name) : undefined}
                              sx={{ borderRadius: 2 }}
                            />
                          );
                        })}
                      </Box>
                      {entry.editable && (
                        <Stack direction="row" spacing={0.5} sx={{ mt: 1.5 }} alignItems="center">
                          <TextField
                            size="small"
                            placeholder={t("addPlayerToTeam")}
                            value={newPlayerInputs[teamIdx] ?? ""}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewPlayerInputs((prev) => ({ ...prev, [teamIdx]: e.target.value.slice(0, 50) }))}
                            onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter") { e.preventDefault(); addPlayerToTeam(teamIdx); } }}
                            inputProps={{ maxLength: 50 }}
                            sx={{ flex: 1, "& .MuiOutlinedInput-root": { borderRadius: 2 } }}
                          />
                          <IconButton
                            size="small" color="primary"
                            disabled={!(newPlayerInputs[teamIdx] ?? "").trim()}
                            onClick={() => addPlayerToTeam(teamIdx)}
                          >
                            <PersonAddIcon fontSize="small" />
                          </IconButton>
                        </Stack>
                      )}
                    </Box>
                  </Grid2>
                ))}
              </Grid2>
            </Section>
          </Box>
        )}

        {/* ── Payments ── */}
        {payments.length > 0 && !isCancelled && (
          <Box sx={{ px: 3, py: 2.5 }}>
            <Section
              title={t("historyPayments")}
              icon={<PaymentIcon fontSize="small" sx={{ color: "text.secondary" }} />}
              action={
                entry.editable && paymentsDirty ? (
                  <Button variant="contained" size="small" disableElevation startIcon={<SaveIcon />}
                    onClick={handleSavePayments} disabled={saving}
                    sx={{ borderRadius: 2, textTransform: "none", fontWeight: 600 }}>
                    {t("savePayments")}
                  </Button>
                ) : undefined
              }
            >
              <Box sx={{
                p: 2, borderRadius: 3,
                backgroundColor: alpha(theme.palette.action.hover, 0.04),
                border: `1px solid ${alpha(theme.palette.divider, 0.08)}`,
              }}>
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
                  {(entry.editable ? editablePayments : payments).map((p, idx) => {
                    const isPaid = p.status === "paid";
                    const isExempt = p.status === "exempt";
                    const chipColor = isPaid ? "success" : isExempt ? "default" : "warning";
                    return (
                      <Chip
                        key={p.playerName}
                        size="small"
                        variant={isPaid ? "filled" : "outlined"}
                        color={chipColor}
                        label={`${p.playerName}  ${p.amount.toFixed(2)}`}
                        onClick={entry.editable ? () => cyclePaymentStatus(idx) : undefined}
                        sx={{
                          borderRadius: 2,
                          fontWeight: isPaid ? 600 : 400,
                          ...(entry.editable ? { cursor: "pointer" } : {}),
                        }}
                      />
                    );
                  })}
                </Box>
                {payments.some((p) => p.method) && (
                  <Stack spacing={0.25} sx={{ mt: 1.5, pt: 1.5, borderTop: `1px dashed ${alpha(theme.palette.divider, 0.2)}` }}>
                    {payments.filter((p) => p.method).map((p) => (
                      <Typography key={p.playerName} variant="caption" color="text.secondary">
                        {t("historyPaymentRef", { ref: `${p.playerName}: ${p.method}` })}
                      </Typography>
                    ))}
                  </Stack>
                )}
              </Box>
            </Section>
          </Box>
        )}
        {payments.length === 0 && entry.paymentsSnapshot !== null && !isCancelled && (
          <Box sx={{ px: 3, py: 2.5 }}>
            <Typography variant="body2" color="text.secondary">{t("historyNoPayments")}</Typography>
          </Box>
        )}

        {/* ── Status + Editable info ── */}
        {entry.editable && (
          <Box sx={{ px: 3, py: 2.5 }}>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
              <Button
                size="small"
                variant={isCancelled ? "outlined" : "contained"}
                color="success"
                disableElevation
                startIcon={<CheckCircleIcon />}
                disabled={saving}
                onClick={() => patch({ status: "played" })}
                sx={{ borderRadius: 2, textTransform: "none", fontWeight: 600 }}
              >
                {t("markPlayed")}
              </Button>
              <Button
                size="small"
                variant={isCancelled ? "contained" : "outlined"}
                color="error"
                disableElevation
                startIcon={<CancelIcon />}
                disabled={saving}
                onClick={() => patch({ status: "cancelled" })}
                sx={{ borderRadius: 2, textTransform: "none", fontWeight: 600 }}
              >
                {t("markCancelled")}
              </Button>
              <Typography variant="caption" color="text.disabled" sx={{ ml: "auto !important" }}>
                {t("editableUntil", {
                  date: editableUntil.toLocaleDateString(localeStr, {
                    day: "numeric", month: "short", year: "numeric",
                  }),
                })}
              </Typography>
            </Stack>
          </Box>
        )}
      </Stack>
    </Paper>
  );
}

// ── History page ──────────────────────────────────────────────────────────────

export default function HistoryPage({ eventId }: { eventId: string }) {
  const t = useT();
  const locale = detectLocale();
  const [title, setTitle] = useState("");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async () => {
    const [evRes, histRes] = await Promise.all([
      fetch(`/api/events/${eventId}`),
      fetch(`/api/events/${eventId}/history`),
    ]);
    if (evRes.status === 404) { setNotFound(true); setLoading(false); return; }
    const ev = await evRes.json();
    const hist = await histRes.json();
    setTitle(ev.title);
    setHistory(hist.data);
    setNextCursor(hist.nextCursor);
    setHasMore(hist.hasMore);
    setLoading(false);
  }, [eventId]);

  useEffect(() => { load(); }, [load]);

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    const res = await fetch(`/api/events/${eventId}/history?cursor=${nextCursor}`);
    const page = await res.json();
    setHistory((prev) => [...prev, ...page.data]);
    setNextCursor(page.nextCursor);
    setHasMore(page.hasMore);
    setLoadingMore(false);
  };

  const handleUpdate = (updated: HistoryEntry) => {
    setHistory((prev) => prev.map((h) => h.id === updated.id ? updated : h));
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
              <Button variant="outlined" startIcon={<ArrowBackIcon />} href={`/events/${eventId}`} size="small"
                sx={{ borderRadius: 2, textTransform: "none" }}>
                {t("backToGame")}
              </Button>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <HistoryIcon color="primary" />
                <Typography variant="h5" fontWeight={700}>
                  {t("historyTitle", { title })}
                </Typography>
              </Box>
            </Box>

            <Button variant="outlined" startIcon={<EmojiEventsIcon />}
              href={`/events/${eventId}/rankings`} size="small"
              sx={{ alignSelf: "flex-start", borderRadius: 2, textTransform: "none" }}>
              {t("ratings")}
            </Button>

            {history.length === 0 ? (
              <Paper elevation={0} sx={{
                borderRadius: 4, p: 4, textAlign: "center",
                border: "1px solid",
                borderColor: "divider",
              }}>
                <SportsIcon sx={{ fontSize: 48, color: "text.disabled", mb: 1 }} />
                <Typography variant="h6" color="text.secondary">{t("noHistory")}</Typography>
                <Typography variant="body2" color="text.disabled" mt={1}>{t("noHistoryDesc")}</Typography>
              </Paper>
            ) : (
              <>
                {history.map((entry) => (
                  <HistoryCardFull key={entry.id} entry={entry} eventId={eventId} onUpdate={handleUpdate} />
                ))}
                {hasMore && (
                  <Box sx={{ display: "flex", justifyContent: "center", pt: 2 }}>
                    <Button variant="outlined" onClick={loadMore} disabled={loadingMore}
                      sx={{ borderRadius: 2, textTransform: "none" }}>
                      {loadingMore ? t("loading") : t("loadMore")}
                    </Button>
                  </Box>
                )}
              </>
            )}
          </Stack>
        </Container>
      </ResponsiveLayout>
    </ThemeModeProvider>
  );
}
