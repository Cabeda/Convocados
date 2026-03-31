import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Container, Paper, Typography, Box, Stack, Chip, Button, Divider,
  CircularProgress, Alert, TextField, Autocomplete, InputAdornment,
  alpha, useTheme, IconButton, Tooltip, Grid2, Dialog, DialogTitle,
  DialogContent, DialogActions, Snackbar,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import HistoryIcon from "@mui/icons-material/History";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CancelIcon from "@mui/icons-material/Cancel";
import LockIcon from "@mui/icons-material/Lock";
import LockOpenIcon from "@mui/icons-material/LockOpen";
import SaveIcon from "@mui/icons-material/Save";
import SportsIcon from "@mui/icons-material/Sports";
import PersonAddIcon from "@mui/icons-material/PersonAdd";
import EmojiEventsIcon from "@mui/icons-material/EmojiEvents";
import PaymentIcon from "@mui/icons-material/Payment";
import LoginIcon from "@mui/icons-material/Login";
import AddCircleIcon from "@mui/icons-material/AddCircle";
import { ThemeModeProvider } from "./ThemeModeProvider";
import { ResponsiveLayout } from "./ResponsiveLayout";
import { useT } from "~/lib/useT";
import { detectLocale } from "~/lib/i18n";
import { useSession } from "~/lib/auth.client";
import { matchesWithName } from "~/lib/stringMatch";
import { computeGameUpdates, type EloUpdate } from "~/lib/elo";
import { ScoreRoller } from "./event/ScoreRoller";
import { PlayerAutocomplete } from "./event/PlayerAutocomplete";

type PlayerOption =
  | { type: "existing"; name: string; gamesPlayed: number }
  | { type: "create"; name: string };

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
  source: string;
  eloProcessed: boolean;
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

interface AddHistoricalGameDialogProps {
  open: boolean;
  onClose: () => void;
  eventId: string;
  defaultTeamOneName: string;
  defaultTeamTwoName: string;
  knownPlayers: { name: string; gamesPlayed: number }[];
  playerRatings: { name: string; rating: number; gamesPlayed: number }[];
  onSuccess: (entry: HistoryEntry) => void;
}

function AddHistoricalGameDialog({
  open,
  onClose,
  eventId,
  defaultTeamOneName,
  defaultTeamTwoName,
  knownPlayers,
  playerRatings,
  onSuccess,
}: AddHistoricalGameDialogProps) {
  const t = useT();
  const theme = useTheme();
  const [dateTime, setDateTime] = useState(() => {
    const d = new Date();
    d.setHours(d.getHours() - 1, 0, 0, 0);
    return d.toISOString().slice(0, 16);
  });
  const [teamOneName, setTeamOneName] = useState(defaultTeamOneName);
  const [teamTwoName, setTeamTwoName] = useState(defaultTeamTwoName);
  const [scoreOne, setScoreOne] = useState("");
  const [scoreTwo, setScoreTwo] = useState("");
  const [team1Players, setTeam1Players] = useState<{ name: string; order: number }[]>([]);
  const [team2Players, setTeam2Players] = useState<{ name: string; order: number }[]>([]);
  const [newPlayerInputs, setNewPlayerInputs] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setDateTime(new Date().toISOString().slice(0, 16));
      setTeamOneName(defaultTeamOneName);
      setTeamTwoName(defaultTeamTwoName);
      setScoreOne("");
      setScoreTwo("");
      setTeam1Players([]);
      setTeam2Players([]);
      setNewPlayerInputs({});
      setError(null);
    }
  }, [open, defaultTeamOneName, defaultTeamTwoName]);

  // ELO preview computation
  const eloPreview: EloUpdate[] = useMemo(() => {
    if (team1Players.length === 0 || team2Players.length === 0) return [];
    const s1 = scoreOne === "" ? null : parseInt(scoreOne, 10);
    const s2 = scoreTwo === "" ? null : parseInt(scoreTwo, 10);
    if (s1 == null || s2 == null) return [];
    const teams = [
      { team: teamOneName, players: team1Players },
      { team: teamTwoName, players: team2Players },
    ];
    return computeGameUpdates(playerRatings, teams, s1, s2);
  }, [team1Players, team2Players, teamOneName, teamTwoName, scoreOne, scoreTwo, playerRatings]);

  const addPlayerToTeam = (teamIdx: number, playerName?: string) => {
    const name = (playerName ?? newPlayerInputs[teamIdx] ?? "").trim();
    if (!name) return;
    const target = teamIdx === 0 ? team1Players : team2Players;
    if (target.some((p) => p.name.toLowerCase() === name.toLowerCase())) return;
    const newPlayer = { name, order: target.length };
    if (teamIdx === 0) {
      setTeam1Players([...team1Players, newPlayer]);
    } else {
      setTeam2Players([...team2Players, newPlayer]);
    }
    if (!playerName) setNewPlayerInputs((prev) => ({ ...prev, [teamIdx]: "" }));
  };

  const removePlayerFromTeam = (teamIdx: number, playerName: string) => {
    if (teamIdx === 0) {
      setTeam1Players(team1Players.filter((p) => p.name !== playerName).map((p, i) => ({ ...p, order: i })));
    } else {
      setTeam2Players(team2Players.filter((p) => p.name !== playerName).map((p, i) => ({ ...p, order: i })));
    }
  };

  const handleSubmit = async () => {
    if (!dateTime || !teamOneName || !teamTwoName || scoreOne === "" || scoreTwo === "") {
      setError(t("errorPlayerNameRequired"));
      return;
    }
    if (team1Players.length === 0 || team2Players.length === 0) {
      setError(t("errorNeedMorePlayers"));
      return;
    }

    setSaving(true);
    setError(null);

    const teamsSnapshot = [
      { team: teamOneName, players: team1Players },
      { team: teamTwoName, players: team2Players },
    ];

    try {
      const res = await fetch(`/api/events/${eventId}/history`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dateTime: new Date(dateTime).toISOString(),
          teamOneName,
          teamTwoName,
          scoreOne: parseInt(scoreOne, 10),
          scoreTwo: parseInt(scoreTwo, 10),
          teamsSnapshot,
        }),
      });

      if (!res.ok) {
        const json = await res.json();
        setError(json.error || t("errorCreatingPastGame"));
        setSaving(false);
        return;
      }

      const newEntry = await res.json();
      onSuccess(newEntry);
      onClose();
    } catch {
      setError(t("errorCreatingPastGame"));
    }
    setSaving(false);
  };

  const getAvailableSuggestions = (teamIdx: number) => {
    const currentNames = new Set(
      (teamIdx === 0 ? team1Players : team2Players).map((p) => p.name.toLowerCase())
    );
    return knownPlayers.filter((kp) => !currentNames.has(kp.name.toLowerCase()));
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Stack direction="row" spacing={1} alignItems="center">
          <AddCircleIcon color="primary" />
          <Typography variant="h6" fontWeight={700}>{t("addHistoricalGame")}</Typography>
        </Stack>
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={3} sx={{ pt: 1 }}>
          <Alert severity="info" sx={{ borderRadius: 2 }}>{t("addHistoricalGameDesc")}</Alert>

          {error && <Alert severity="error" onClose={() => setError(null)} sx={{ borderRadius: 2 }}>{error}</Alert>}

          <TextField
            label={t("dateTime")}
            type="datetime-local"
            value={dateTime}
            onChange={(e) => setDateTime(e.target.value)}
            fullWidth
            InputLabelProps={{ shrink: true }}
          />

          <Stack direction="row" spacing={2}>
            <TextField
              label={t("pastGameTeam1Name")}
              value={teamOneName}
              onChange={(e) => setTeamOneName(e.target.value)}
              fullWidth
              size="small"
            />
            <TextField
              label={t("pastGameTeam2Name")}
              value={teamTwoName}
              onChange={(e) => setTeamTwoName(e.target.value)}
              fullWidth
              size="small"
            />
          </Stack>

          <Box sx={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 3,
            py: 2, px: 3, borderRadius: 3,
            backgroundColor: alpha(theme.palette.action.hover, 0.04),
            border: `1px solid ${alpha(theme.palette.divider, 0.08)}`,
          }}>
            <ScoreRoller
              value={scoreOne}
              onChange={setScoreOne}
              teamName={teamOneName}
            />
            <Typography variant="h4" color="text.disabled" fontWeight={300}>:</Typography>
            <ScoreRoller
              value={scoreTwo}
              onChange={setScoreTwo}
              teamName={teamTwoName}
            />
          </Box>

          <Typography variant="subtitle2" fontWeight={700}>{t("selectPlayers")}</Typography>

          <Grid2 container spacing={2}>
            {[{ label: teamOneName, players: team1Players, idx: 0 }, { label: teamTwoName, players: team2Players, idx: 1 }].map(({ label, players, idx }) => (
              <Grid2 key={idx} size={{ xs: 12, sm: 6 }}>
                <Box sx={{
                  p: 2, borderRadius: 3,
                  backgroundColor: alpha(theme.palette.action.hover, 0.04),
                  border: `1px solid ${alpha(theme.palette.divider, 0.08)}`,
                }}>
                  <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>{label}</Typography>
                  <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, minHeight: 32 }}>
                    {players.map((p) => (
                      <Chip
                        key={p.name}
                        size="small"
                        variant="outlined"
                        label={p.name}
                        onDelete={() => removePlayerFromTeam(idx, p.name)}
                        sx={{ borderRadius: 2 }}
                      />
                    ))}
                  </Box>
                  <Box sx={{ mt: 1.5 }}>
                    <PlayerAutocomplete
                      value={newPlayerInputs[idx] ?? ""}
                      onChange={(val) => setNewPlayerInputs((prev) => ({ ...prev, [idx]: val }))}
                      onAdd={(name) => addPlayerToTeam(idx, name)}
                      suggestions={getAvailableSuggestions(idx)}
                      disabled={saving}
                      label={t("addPlayerToTeam")}
                    />
                  </Box>
                </Box>
              </Grid2>
            ))}
          </Grid2>

          {/* ELO Preview */}
          {eloPreview.length > 0 && (
            <Box sx={{
              p: 2, borderRadius: 3,
              backgroundColor: alpha(theme.palette.action.hover, 0.04),
              border: `1px solid ${alpha(theme.palette.divider, 0.08)}`,
            }}>
              <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1.5 }}>
                {t("ratings")} Preview
              </Typography>
              <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
                {eloPreview.map((update) => (
                  <Box key={update.name} sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <Typography variant="body2">{update.name}</Typography>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      <Typography variant="caption" color="text.secondary">
                        {update.oldRating}
                      </Typography>
                      <Typography
                        variant="body2"
                        fontWeight={700}
                        color={update.delta > 0 ? "success.main" : update.delta < 0 ? "error.main" : "text.primary"}
                      >
                        {update.delta > 0 ? "+" : ""}{update.delta}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        → {update.newRating}
                      </Typography>
                    </Box>
                  </Box>
                ))}
              </Box>
            </Box>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} disabled={saving}>{t("cancel")}</Button>
        <Button variant="contained" onClick={handleSubmit} disabled={saving} startIcon={<SaveIcon />}>
          {saving ? t("creatingPastGame") : t("createPastGame")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function HistoryCardFull({
  entry,
  eventId,
  onUpdate,
  isAuthenticated,
  knownPlayers,
  playerRatings,
  isOwner,
}: {
  entry: HistoryEntry;
  eventId: string;
  onUpdate: (updated: HistoryEntry) => void;
  isAuthenticated: boolean;
  knownPlayers: { name: string; gamesPlayed: number }[];
  playerRatings: { name: string; rating: number; gamesPlayed: number }[];
  isOwner: boolean;
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

  // Drag state for moving players between teams
  const [dragPlayer, setDragPlayer] = useState<{ name: string; fromTeam: number } | null>(null);

  // Gate editing on both time-based editability AND authentication
  const canEdit = entry.editable && isAuthenticated;

  const [unlocking, setUnlocking] = useState(false);
  const handleToggleLock = async () => {
    setUnlocking(true);
    setError(null);
    const action = entry.editable ? { lock: true } : { unlock: true };
    const res = await fetch(`/api/events/${eventId}/history/${entry.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(action),
    });
    const json = await res.json();
    setUnlocking(false);
    if (!res.ok) { setError(json.error); return; }
    onUpdate(json);
  };

  const [approvingElo, setApprovingElo] = useState(false);
  const handleApproveElo = async () => {
    setApprovingElo(true);
    setError(null);
    const res = await fetch(`/api/events/${eventId}/history/${entry.id}/approve-elo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const json = await res.json();
    setApprovingElo(false);
    if (!res.ok) { setError(json.error); return; }
    onUpdate(json);
  };

  // Live ELO preview: compute deltas from current editable teams + scores
  const liveEloUpdates: EloUpdate[] = useMemo(() => {
    if (isCancelled || editableTeams.length !== 2) return [];
    const s1 = scoreOne === "" ? null : parseInt(scoreOne, 10);
    const s2 = scoreTwo === "" ? null : parseInt(scoreTwo, 10);
    if (s1 == null || s2 == null || isNaN(s1) || isNaN(s2)) return [];
    return computeGameUpdates(playerRatings, editableTeams, s1, s2);
  }, [editableTeams, scoreOne, scoreTwo, playerRatings, isCancelled]);

  // Duplicate detection across teams
  const duplicateNames = useMemo(() => {
    if (editableTeams.length < 2) return [];
    const seen = new Map<string, number>();
    const dupes: string[] = [];
    for (const team of editableTeams) {
      for (const p of team.players) {
        const lower = p.name.toLowerCase();
        if (seen.has(lower)) dupes.push(p.name);
        else seen.set(lower, 1);
      }
    }
    return [...new Set(dupes)];
  }, [editableTeams]);

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

  const addPlayerToTeam = (teamIdx: number, playerName?: string) => {
    const name = (playerName ?? newPlayerInputs[teamIdx] ?? "").trim();
    if (!name) return;
    // Allow temporary duplicates during editing — validated on save
    setEditableTeams((prev) => prev.map((t, i) => {
      if (i !== teamIdx) return t;
      // Don't add if already on this specific team
      if (t.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) return t;
      return { ...t, players: [...t.players, { name, order: t.players.length }] };
    }));
    if (!playerName) setNewPlayerInputs((prev) => ({ ...prev, [teamIdx]: "" }));
    setTeamsDirty(true);
  };

  const handleSaveTeams = () => {
    if (duplicateNames.length > 0) {
      setError(t("duplicatePlayerWarning", { names: duplicateNames.join(", ") }));
      return;
    }
    patch({ teamsSnapshot: editableTeams });
    setTeamsDirty(false);
  };

  // Drag & drop handlers
  const handleDragStart = (playerName: string, fromTeam: number) => {
    setDragPlayer({ name: playerName, fromTeam });
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDrop = (targetTeam: number) => {
    if (!dragPlayer || dragPlayer.fromTeam === targetTeam) {
      setDragPlayer(null);
      return;
    }
    // Move player from source team to target team
    setEditableTeams((prev) => {
      const updated = prev.map((t, i) => {
        if (i === dragPlayer.fromTeam) {
          const filtered = t.players.filter((p) => p.name !== dragPlayer.name);
          return { ...t, players: filtered.map((p, j) => ({ ...p, order: j })) };
        }
        if (i === targetTeam) {
          // Allow temporary duplicate — validated on save
          return { ...t, players: [...t.players, { name: dragPlayer.name, order: t.players.length }] };
        }
        return t;
      });
      return updated;
    });
    setTeamsDirty(true);
    setDragPlayer(null);
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

  // Filter known players for autocomplete: exclude players already on this team
  const getAvailableSuggestions = (teamIdx: number) => {
    const currentNames = new Set(
      editableTeams[teamIdx]?.players.map((p) => p.name.toLowerCase()) ?? []
    );
    return knownPlayers.filter((kp) => !currentNames.has(kp.name.toLowerCase()));
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
          {entry.source === "historical" && (
            <Chip
              icon={<HistoryIcon />}
              label={t("historicalGame")}
              color="warning"
              size="small"
              variant="outlined"
              sx={{ fontWeight: 600 }}
            />
          )}
          <Chip
            icon={isCancelled ? <CancelIcon /> : <CheckCircleIcon />}
            label={isCancelled ? t("statusCancelled") : t("statusPlayed")}
            color={isCancelled ? "error" : "success"}
            size="small"
            sx={{ fontWeight: 600 }}
          />
          {isOwner ? (
            <Tooltip title={entry.editable ? t("lockHistory") : t("unlockHistory")}>
              <span>
                <IconButton size="small" color={entry.editable ? "default" : "warning"} onClick={handleToggleLock} disabled={unlocking}>
                  {entry.editable ? <LockOpenIcon fontSize="small" /> : <LockIcon fontSize="small" />}
                </IconButton>
              </span>
            </Tooltip>
          ) : !entry.editable ? (
            <Tooltip title={t("notEditable")}>
              <LockIcon fontSize="small" color="disabled" />
            </Tooltip>
          ) : null}
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
              canEdit ? (
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
                  {canEdit ? (
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
                  {canEdit ? (
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

        {/* ── ELO Approval for Historical Games ── */}
        {entry.source === "historical" && !isCancelled && (
          <Box sx={{ px: 3, py: 2.5 }}>
            <Section
              title={entry.eloProcessed ? t("eloApproved") : t("eloPending")}
              icon={<EmojiEventsIcon fontSize="small" sx={{ color: entry.eloProcessed ? "success.main" : "warning.main" }} />}
              action={
                !entry.eloProcessed && isOwner ? (
                  <Button
                    variant="contained"
                    size="small"
                    disableElevation
                    startIcon={<EmojiEventsIcon />}
                    onClick={handleApproveElo}
                    disabled={approvingElo}
                    sx={{ borderRadius: 2, textTransform: "none", fontWeight: 600 }}
                  >
                    {approvingElo ? t("approvingElo") : t("approveElo")}
                  </Button>
                ) : undefined
              }
            >
              {entry.eloProcessed ? (
                <Alert severity="success" sx={{ borderRadius: 2 }}>
                  {t("eloApprovedSuccess")}
                </Alert>
              ) : (
                <Alert severity="warning" sx={{ borderRadius: 2 }}>
                  {t("eloPending")}
                </Alert>
              )}
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
                canEdit && teamsDirty ? (
                  <Button variant="contained" size="small" disableElevation startIcon={<SaveIcon />}
                    onClick={handleSaveTeams} disabled={saving || duplicateNames.length > 0}
                    sx={{ borderRadius: 2, textTransform: "none", fontWeight: 600 }}>
                    {t("saveTeams")}
                  </Button>
                ) : undefined
              }
            >
              {duplicateNames.length > 0 && (
                <Alert severity="warning" sx={{ mb: 1.5, borderRadius: 2 }}>
                  {t("duplicatePlayerWarning", { names: duplicateNames.join(", ") })}
                </Alert>
              )}
              <Grid2 container spacing={2}>
                {(canEdit ? editableTeams : teams).map((team, teamIdx) => {
                  const availableSuggestions = canEdit ? getAvailableSuggestions(teamIdx) : [];
                  const inputValue = newPlayerInputs[teamIdx] ?? "";
                  return (
                  <Grid2 key={team.team} size={{ xs: 12, sm: 6 }}>
                    <Box
                      onDragOver={canEdit ? handleDragOver : undefined}
                      onDrop={canEdit ? () => handleDrop(teamIdx) : undefined}
                      sx={{
                        p: 2, borderRadius: 3,
                        backgroundColor: alpha(theme.palette.action.hover, 0.04),
                        border: `1px solid ${alpha(theme.palette.divider, 0.08)}`,
                        ...(canEdit && dragPlayer && dragPlayer.fromTeam !== teamIdx ? {
                          border: `2px dashed ${alpha(theme.palette.primary.main, 0.4)}`,
                          backgroundColor: alpha(theme.palette.primary.main, 0.04),
                        } : {}),
                        transition: "border 0.2s, background-color 0.2s",
                      }}
                    >
                      <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>{team.team}</Typography>
                      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
                        {team.players.map((p) => {
                          const liveElo = liveEloUpdates.find((e) => e.name === p.name);
                          const savedElo = entry.eloUpdates?.find((e) => e.name === p.name);
                          const elo = liveElo ?? savedElo;
                          const deltaLabel = elo ? (elo.delta >= 0 ? `+${elo.delta}` : `${elo.delta}`) : null;
                          const isDuplicate = duplicateNames.some((d) => d.toLowerCase() === p.name.toLowerCase());
                          return (
                            <Chip
                              key={p.name} size="small" variant="outlined"
                              draggable={canEdit}
                              onDragStart={canEdit ? () => handleDragStart(p.name, teamIdx) : undefined}
                              color={isDuplicate ? "error" : "default"}
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
                              onDelete={canEdit ? () => removePlayerFromTeam(teamIdx, p.name) : undefined}
                              sx={{
                                borderRadius: 2,
                                ...(canEdit ? { cursor: "grab", "&:active": { cursor: "grabbing" } } : {}),
                              }}
                            />
                          );
                        })}
                      </Box>
                      {canEdit && (
                        <Box sx={{ mt: 1.5 }}>
                          <Autocomplete<PlayerOption, false, false, true>
                            freeSolo
                            size="small"
                            options={(() => {
                              const trimmed = inputValue.trim();
                              const filtered: PlayerOption[] = availableSuggestions
                                .filter((s) => matchesWithName(s.name, trimmed))
                                .map((s) => ({ type: "existing" as const, name: s.name, gamesPlayed: s.gamesPlayed }));
                              if (trimmed && !filtered.some((o) => o.name.toLowerCase() === trimmed.toLowerCase())) {
                                filtered.push({ type: "create" as const, name: trimmed });
                              }
                              return filtered;
                            })()}
                            filterOptions={(options) => options}
                            getOptionLabel={(option) =>
                              typeof option === "string" ? option : option.name
                            }
                            isOptionEqualToValue={(option, value) =>
                              option.type === value.type && option.name === value.name
                            }
                            value={null}
                            inputValue={inputValue}
                            onInputChange={(_, newInputValue, reason) => {
                              if (reason === "reset") return;
                              setNewPlayerInputs((prev) => ({ ...prev, [teamIdx]: newInputValue }));
                            }}
                            onChange={(_, newValue) => {
                              if (!newValue) return;
                              const name = typeof newValue === "string" ? newValue.trim() : newValue.name;
                              if (name) {
                                addPlayerToTeam(teamIdx, name);
                                setNewPlayerInputs((prev) => ({ ...prev, [teamIdx]: "" }));
                              }
                            }}
                            renderInput={(params) => (
                              <TextField
                                {...params}
                                placeholder={t("addPlayerToTeam")}
                                inputProps={{ ...params.inputProps, maxLength: 50 }}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" && inputValue.trim()) {
                                    const trimmed = inputValue.trim();
                                    const hasMatch = availableSuggestions.some(
                                      (s) => matchesWithName(s.name, trimmed)
                                    );
                                    if (!hasMatch) {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      addPlayerToTeam(teamIdx, trimmed);
                                      setNewPlayerInputs((prev) => ({ ...prev, [teamIdx]: "" }));
                                    }
                                  }
                                }}
                                InputProps={{
                                  ...params.InputProps,
                                  endAdornment: (
                                    <InputAdornment position="end">
                                      <IconButton size="small" color="primary" edge="end"
                                        disabled={!inputValue.trim()}
                                        onClick={() => {
                                          addPlayerToTeam(teamIdx, inputValue.trim());
                                          setNewPlayerInputs((prev) => ({ ...prev, [teamIdx]: "" }));
                                        }}>
                                        <PersonAddIcon fontSize="small" />
                                      </IconButton>
                                    </InputAdornment>
                                  ),
                                }}
                                sx={{ "& .MuiOutlinedInput-root": { borderRadius: 2 } }}
                              />
                            )}
                            renderOption={(props, option) => {
                              const { key, ...otherProps } = props as any;
                              if (option.type === "create") {
                                return (
                                  <li key={key} {...otherProps} style={{ minHeight: 40, fontStyle: "italic", display: "flex", alignItems: "center", gap: 8 }}>
                                    <PersonAddIcon fontSize="small" color="primary" />
                                    {t("createNewPlayer", { name: option.name })}
                                  </li>
                                );
                              }
                              return (
                                <li key={key} {...otherProps} style={{ minHeight: 40, display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
                                  <span>{option.name}</span>
                                  {option.gamesPlayed > 0 && (
                                    <Typography variant="caption" color="text.secondary" sx={{ ml: 1, flexShrink: 0 }}>
                                      {t("nGamesPlayed", { n: option.gamesPlayed })}
                                    </Typography>
                                  )}
                                </li>
                              );
                            }}
                            noOptionsText={t("noSuggestions")}
                          />
                        </Box>
                      )}
                    </Box>
                  </Grid2>
                  );
                })}
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
                canEdit && paymentsDirty ? (
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
                  {(canEdit ? editablePayments : payments).map((p, idx) => {
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
                        onClick={canEdit ? () => cyclePaymentStatus(idx) : undefined}
                        sx={{
                          borderRadius: 2,
                          fontWeight: isPaid ? 600 : 400,
                          ...(canEdit ? { cursor: "pointer" } : {}),
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
        {canEdit && (
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
        {entry.editable && !isAuthenticated && (
          <Box sx={{ px: 3, py: 2 }}>
            <Alert severity="info" icon={<LoginIcon />} sx={{ borderRadius: 2 }}>
              {t("loginRequiredToEdit")}
            </Alert>
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
  const { data: session } = useSession();
  const isAuthenticated = !!session?.user;
  const [title, setTitle] = useState("");
  const [teamOneName, setTeamOneName] = useState("");
  const [teamTwoName, setTeamTwoName] = useState("");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [knownPlayers, setKnownPlayers] = useState<{ name: string; gamesPlayed: number }[]>([]);
  const [playerRatings, setPlayerRatings] = useState<{ name: string; rating: number; gamesPlayed: number }[]>([]);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showAddHistorical, setShowAddHistorical] = useState(false);
  const isOwner = !!(session?.user && ownerId && session.user.id === ownerId);

  const load = useCallback(async () => {
    const [evRes, histRes] = await Promise.all([
      fetch(`/api/events/${eventId}`),
      fetch(`/api/events/${eventId}/history`),
    ]);
    if (evRes.status === 404) { setNotFound(true); setLoading(false); return; }
    const ev = await evRes.json();
    const hist = await histRes.json();
    setTitle(ev.title);
    setTeamOneName(ev.teamOneName ?? "Team A");
    setTeamTwoName(ev.teamTwoName ?? "Team B");
    setOwnerId(ev.ownerId ?? null);
    setIsAdmin(!!ev.isAdmin);
    setHistory(hist.data);
    setNextCursor(hist.nextCursor);
    setHasMore(hist.hasMore);
    setLoading(false);

    // Fetch known players (historical) and ratings in parallel (non-blocking)
    // Combine current event players with historical players for suggestions
    const currentPlayers = (ev.players ?? []).map((p: any) => ({ name: p.name, gamesPlayed: -1 })); // -1 indicates current player
    Promise.all([
      fetch(`/api/events/${eventId}/known-players`).then((r) => r.json()).catch(() => ({ players: [] })),
      fetch(`/api/events/${eventId}/ratings`).then((r) => r.json()).catch(() => ({ data: [] })),
    ]).then(([kp, ratings]) => {
      // Combine current players with historical players, deduping by name
      const allPlayersMap = new Map<string, { name: string; gamesPlayed: number }>();
      // Current players first (they get priority)
      currentPlayers.forEach((p: { name: string; gamesPlayed: number }) => allPlayersMap.set(p.name.toLowerCase(), p));
      // Historical players (only if not already in current)
      (kp.players ?? []).forEach((p: { name: string; gamesPlayed: number }) => {
        if (!allPlayersMap.has(p.name.toLowerCase())) {
          allPlayersMap.set(p.name.toLowerCase(), p);
        }
      });
      setKnownPlayers(Array.from(allPlayersMap.values()));
      setPlayerRatings(
        (ratings.data ?? []).map((r: any) => ({ name: r.name, rating: r.rating, gamesPlayed: r.gamesPlayed }))
      );
    });
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

  const handleAddHistoricalSuccess = (newEntry: HistoryEntry) => {
    setHistory((prev) => [newEntry, ...prev]);
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

            {(isOwner || isAdmin) && (
              <Button variant="contained" startIcon={<AddCircleIcon />}
                onClick={() => setShowAddHistorical(true)} size="small"
                sx={{ alignSelf: "flex-start", borderRadius: 2, textTransform: "none" }}>
                {t("addHistoricalGame")}
              </Button>
            )}

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
                  <HistoryCardFull key={entry.id} entry={entry} eventId={eventId} onUpdate={handleUpdate}
                    isAuthenticated={isAuthenticated} knownPlayers={knownPlayers} playerRatings={playerRatings}
                    isOwner={isOwner || isAdmin} />
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

          <AddHistoricalGameDialog
            open={showAddHistorical}
            onClose={() => setShowAddHistorical(false)}
            eventId={eventId}
            defaultTeamOneName={teamOneName}
            defaultTeamTwoName={teamTwoName}
            knownPlayers={knownPlayers}
            playerRatings={playerRatings}
            onSuccess={handleAddHistoricalSuccess}
          />
        </Container>
      </ResponsiveLayout>
    </ThemeModeProvider>
  );
}
