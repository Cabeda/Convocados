/* eslint-disable react-hooks/set-state-in-effect -- Sync-from-server pattern: server data initializes local state, async fetch responses set state. Common in this codebase. */
/**
 * Typography scale (minimum sizes enforced by HistoryCardFull.test.tsx):
 * - Score:          2.75rem (44px) mobile / 3.5rem (56px) desktop
 * - Team names:     1rem (16px) mobile / 1.15rem (18.4px) desktop
 * - ELO / paid chip: 0.8rem (12.8px) — floor for metadata chips
 * - Status / date:  body2 (14px) / caption (12px)
 * - Anything below 0.75rem (12px) is a regression.
 */
import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  Box, Stack, Chip, Button, Paper,
  Alert, TextField, Autocomplete, InputAdornment,
  alpha, useTheme, IconButton, Tooltip, Dialog, DialogTitle,
  DialogContent, DialogActions, Menu, MenuItem, ListItemIcon, ListItemText, Typography,
  Popover,
} from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CancelIcon from "@mui/icons-material/Cancel";
import LockIcon from "@mui/icons-material/Lock";
import LockOpenIcon from "@mui/icons-material/LockOpen";
import SportsIcon from "@mui/icons-material/Sports";
import PersonAddIcon from "@mui/icons-material/PersonAdd";
import EmojiEventsIcon from "@mui/icons-material/EmojiEvents";

import LocationOnIcon from "@mui/icons-material/LocationOn";
import AttachMoneyIcon from "@mui/icons-material/AttachMoney";
import DeleteIcon from "@mui/icons-material/Delete";
import SentimentSatisfiedAltIcon from "@mui/icons-material/SentimentSatisfiedAlt";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import RemoveIcon from "@mui/icons-material/Remove";
import AddIcon from "@mui/icons-material/Add";
import EventIcon from "@mui/icons-material/Event";
import LoginIcon from "@mui/icons-material/Login";
import HistoryIcon from "@mui/icons-material/History";
import { useT } from "~/lib/useT";
import { detectLocale, type TFunction } from "~/lib/i18n";
import { matchesWithName } from "~/lib/stringMatch";
import { computeGameUpdates, expectedScore, kFactor, type EloUpdate } from "~/lib/elo";
import { formatDateInTz } from "~/lib/timezones";

type PlayerOption =
  | { type: "existing"; name: string; gamesPlayed: number; userId: string | null }
  | { type: "create"; name: string };

export interface HistoryCardFullEntry {
  id: string;
  eventId: string;
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
  isFriendly: boolean;
  eloUpdates?: { name: string; delta: number }[] | null;
  participants?: string[];
}

interface EventLite {
  id: string;
  title: string;
  location: string;
  latitude: number | null;
  longitude: number | null;
  timezone: string;
  ownerId: string | null;
}

interface CostSummary {
  totalAmount: number;
  currency: string;
  payments: Array<{ playerName: string; amount: number; status: "paid" | "pending" }>;
  summary?: { paidCount: number; totalCount: number; paidAmount: number };
}

interface MvpCandidate {
  playerId: string;
  playerName: string;
  voteCount: number;
}

interface MvpSummary {
  mvp: MvpCandidate[] | null;
  isVotingOpen: boolean;
  hasVoted: boolean | null;
  totalVotes: number;
  eligibleVoters: number;
  participants: Array<{ id: string; name: string; voteCount: number }>;
}

interface TeamSnapshot {
  team: string;
  players: { name: string; order: number }[];
}

interface PaymentSnapshotEntry {
  playerName: string;
  amount: number;
  status: "paid" | "pending";
  method?: string | null;
}

const SCORE_AUTOSAVE_DEBOUNCE_MS = 400;

function mapsUrl(location: string, lat: number | null, lng: number | null): string {
  if (lat !== null && lng !== null) {
    return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
  }
  return /^https?:\/\//i.test(location)
    ? location
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`;
}

/** Build a multiline ELO breakdown tooltip string for a player's delta. */
function eloTooltipText(
  t: TFunction,
  playerName: string,
  delta: number,
  teams: TeamSnapshot[],
  playerRatings: { name: string; rating: number; gamesPlayed: number }[],
  scoreOne: number | null,
  scoreTwo: number | null,
): string {
  if (teams.length !== 2 || scoreOne === null || scoreTwo === null) {
    return `${delta >= 0 ? "+" : ""}${delta}`;
  }

  const ratingMap = new Map(playerRatings.map((p) => [p.name, p]));
  const getInfo = (name: string) => ratingMap.get(name) ?? { rating: 1000, gamesPlayed: 0 };

  const isTeamOne = teams[0].players.some((p) => p.name === playerName);
  const oppTeamNames = isTeamOne ? teams[1].players.map((p) => p.name) : teams[0].players.map((p) => p.name);

  const playerInfo = getInfo(playerName);
  const oppAvg = oppTeamNames.reduce((sum, n) => sum + getInfo(n).rating, 0) / (oppTeamNames.length || 1);
  const expected = expectedScore(playerInfo.rating, oppAvg);
  const k = kFactor(playerInfo.gamesPlayed);

  const ownScore = isTeamOne ? scoreOne : scoreTwo;
  const oppScore = isTeamOne ? scoreTwo : scoreOne;
  const outcome = ownScore > oppScore ? 1 : ownScore < oppScore ? 0 : 0.5;
  const outcomeLabel = outcome === 1 ? t("eloOutcomeWin") : outcome === 0 ? t("eloOutcomeLoss") : t("eloOutcomeDraw");

  return [
    t("eloTooltipRating", { rating: Math.round(playerInfo.rating) }),
    t("eloTooltipOpponent", { rating: Math.round(oppAvg) }),
    t("eloTooltipExpected", { pct: Math.round(expected * 100) }),
    t("eloTooltipOutcome", { outcome: outcomeLabel }),
    t("eloTooltipK", { k }),
    t("eloTooltipFormula", { delta: `${delta >= 0 ? "+" : ""}${delta}` }),
  ].join("\n");
}

// ponytail: tap-to-popover for ELO chip — works on touch screens where hover tooltips don't fire
function EloChipWithPopover({ label, color, variant, tooltipText }: {
  label: string;
  color: "success" | "error" | "default";
  variant: "filled" | "outlined";
  tooltipText: string;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <Chip size="small" label={label} color={color} variant={variant}
        onClick={(e) => setAnchor(e.currentTarget)}
        sx={{ height: 22, fontSize: "0.8rem", fontWeight: 700, cursor: "pointer" }} />
      <Popover open={!!anchor} anchorEl={anchor} onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: "top", horizontal: "center" }}
        transformOrigin={{ vertical: "bottom", horizontal: "center" }}
        slotProps={{ paper: { sx: { p: 1.5, maxWidth: 260, whiteSpace: "pre-line", fontSize: "0.8rem" } } }}>
        <Typography variant="caption" component="div" sx={{ whiteSpace: "pre-line" }}>
          {tooltipText}
        </Typography>
      </Popover>
    </>
  );
}

export function HistoryCardFull({
  entry,
  eventId,
  event,
  cost,
  mvp,
  onUpdate,
  onDelete,
  isAuthenticated,
  knownPlayers,
  playerRatings,
  isOwner,
  isAdmin,
  userName,
  eventPlayers: _eventPlayers,
}: {
  entry: HistoryCardFullEntry;
  eventId: string;
  event: EventLite;
  cost: CostSummary | null;
  mvp?: MvpSummary | null;
  onUpdate: (updated: HistoryCardFullEntry) => void;
  onDelete: (id: string) => void;
  isAuthenticated: boolean;
  knownPlayers: { name: string; gamesPlayed: number; userId?: string | null }[];
  playerRatings: { name: string; rating: number; gamesPlayed: number }[];
  isOwner: boolean;
  isAdmin: boolean;
  userName: string | null;
  eventPlayers?: { id: string; name: string }[];
}) {
  const t = useT();
  const locale = detectLocale();
  const theme = useTheme();
  const isPlayAdmin = isOwner || isAdmin;

  const [scoreOne, setScoreOne] = useState(entry.scoreOne !== null ? String(entry.scoreOne) : "");
  const [scoreTwo, setScoreTwo] = useState(entry.scoreTwo !== null ? String(entry.scoreTwo) : "");
  const [savingTeams, setSavingTeams] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const teams: TeamSnapshot[] = entry.teamsSnapshot ? JSON.parse(entry.teamsSnapshot) : [];
  const [editableTeams, setEditableTeams] = useState<TeamSnapshot[]>(teams);
  const [newPlayerInputs, setNewPlayerInputs] = useState<Record<number, string>>({});
  const [teamsDirty, setTeamsDirty] = useState(false);

  const payments: PaymentSnapshotEntry[] = entry.paymentsSnapshot ? JSON.parse(entry.paymentsSnapshot) : [];
  const [editablePayments, setEditablePayments] = useState<PaymentSnapshotEntry[]>(payments);
  const date = new Date(entry.dateTime);
  const editableUntil = new Date(entry.editableUntil);
  const isCancelled = entry.status === "cancelled";

  // Drag state
  const [dragPlayer, setDragPlayer] = useState<{ name: string; fromTeam: number } | null>(null);

  // Status menu
  const [statusMenuAnchor, setStatusMenuAnchor] = useState<HTMLElement | null>(null);
  // Admin actions (kebab) menu
  const [moreMenuAnchor, setMoreMenuAnchor] = useState<HTMLElement | null>(null);

  // Mvp vote state
  const [votingFor, setVotingFor] = useState<string | null>(null);
  const [mvpState, setMvpState] = useState<MvpSummary | null>(mvp ?? null);

  // If mvp wasn't passed in, fetch it
  useEffect(() => {
    if (mvp) { setMvpState(mvp); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/events/${eventId}/history/${entry.id}/mvp`);
        if (res.ok && !cancelled) setMvpState(await res.json());
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [eventId, entry.id, mvp]);

  // Permissions
  const isParticipantInGame = (() => {
    if (isPlayAdmin) return true;
    if (!userName) return false;
    const allNames = teams.flatMap((t) => t.players.map((p) => p.name.toLowerCase()));
    if (allNames.includes(userName.toLowerCase())) return true;
    return (entry.participants ?? []).some((n) => n.toLowerCase() === userName.toLowerCase());
  })();
  // Owners/admins bypass the 7-day editable window. Regular players
  // (incl. participants) lose edit access after the window.
  const inEditWindow = entry.editable || isPlayAdmin;
  const canEditScore = isAuthenticated && isParticipantInGame && inEditWindow;
  const canEditTeams = isAuthenticated && (isPlayAdmin || isParticipantInGame) && inEditWindow;
  const canEditPayments = isAuthenticated && isPlayAdmin && inEditWindow;

  const [unlocking, setUnlocking] = useState(false);
  const [togglingFriendly, setTogglingFriendly] = useState(false);
  const [approvingElo, setApprovingElo] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const patch = useCallback(async (data: object) => {
    const res = await fetch(`/api/events/${eventId}/history/${entry.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const json = await res.json();
    if (!res.ok) { setError(json.error); return null; }
    onUpdate(json);
    return json;
  }, [eventId, entry.id, onUpdate]);

  // ── Auto-save score ────────────────────────────────────────────────────────
  const scoreSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedScore = useRef<{ one: number | null; two: number | null }>({
    one: entry.scoreOne,
    two: entry.scoreTwo,
  });

  useEffect(() => {
    const s1 = scoreOne === "" ? null : parseInt(scoreOne, 10);
    const s2 = scoreTwo === "" ? null : parseInt(scoreTwo, 10);
    const s1Norm = s1 !== null && isNaN(s1) ? null : s1;
    const s2Norm = s2 !== null && isNaN(s2) ? null : s2;
    if (s1Norm === lastSavedScore.current.one && s2Norm === lastSavedScore.current.two) return;
    if (!canEditScore) return;

    if (scoreSaveTimer.current) clearTimeout(scoreSaveTimer.current);
    scoreSaveTimer.current = setTimeout(async () => {
      const result = await patch({ scoreOne: s1Norm, scoreTwo: s2Norm });
      if (result) {
        lastSavedScore.current = { one: s1Norm, two: s2Norm };
      }
    }, SCORE_AUTOSAVE_DEBOUNCE_MS);

    return () => {
      if (scoreSaveTimer.current) clearTimeout(scoreSaveTimer.current);
    };
  }, [scoreOne, scoreTwo, canEditScore, patch]);

  // ── Status change ──────────────────────────────────────────────────────────
  const handleStatusChange = async (newStatus: "played" | "cancelled" | "upcoming") => {
    setStatusMenuAnchor(null);
    await patch({ status: newStatus });
  };

  // ── Lock / friendly / approve-elo / delete ─────────────────────────────────
  const handleToggleLock = async () => {
    setUnlocking(true);
    setError(null);
    const action = entry.editable ? { lock: true } : { unlock: true };
    const res = await fetch(`/api/events/${eventId}/history/${entry.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(action),
    });
    setUnlocking(false);
    if (!res.ok) { const j = await res.json(); setError(j.error); return; }
    onUpdate(await res.json());
  };

  const handleToggleFriendly = async () => {
    setTogglingFriendly(true);
    setError(null);
    const res = await fetch(`/api/events/${eventId}/history/${entry.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isFriendly: !entry.isFriendly }),
    });
    setTogglingFriendly(false);
    if (!res.ok) { const j = await res.json(); setError(j.error); return; }
    onUpdate(await res.json());
  };

  const handleApproveElo = async () => {
    setApprovingElo(true);
    setError(null);
    const res = await fetch(`/api/events/${eventId}/history/${entry.id}/approve-elo`, { method: "POST" });
    setApprovingElo(false);
    if (!res.ok) { const j = await res.json(); setError(j.error); return; }
    onUpdate(await res.json());
  };

  const handleDelete = async () => {
    setDeleting(true);
    const res = await fetch(`/api/events/${eventId}/history/${entry.id}`, { method: "DELETE" });
    setDeleting(false);
    setConfirmDelete(false);
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      setError(json.error ?? "Failed to delete.");
      return;
    }
    onDelete(entry.id);
  };

  // ── ELO preview ────────────────────────────────────────────────────────────
  const liveEloUpdates: EloUpdate[] = useMemo(() => {
    if (isCancelled || editableTeams.length !== 2) return [];
    const s1 = scoreOne === "" ? null : parseInt(scoreOne, 10);
    const s2 = scoreTwo === "" ? null : parseInt(scoreTwo, 10);
    if (s1 === null || s2 === null || isNaN(s1) || isNaN(s2)) return [];
    return computeGameUpdates(playerRatings, editableTeams, s1, s2);
  }, [editableTeams, scoreOne, scoreTwo, playerRatings, isCancelled]);

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

  // ── Teams edit ─────────────────────────────────────────────────────────────
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
    setEditableTeams((prev) => prev.map((t, i) => {
      if (i !== teamIdx) return t;
      if (t.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) return t;
      return { ...t, players: [...t.players, { name, order: t.players.length }] };
    }));
    if (!playerName) setNewPlayerInputs((prev) => ({ ...prev, [teamIdx]: "" }));
    setTeamsDirty(true);
  };

  const handleSaveTeams = async () => {
    if (duplicateNames.length > 0) {
      setError(t("duplicatePlayerWarning", { names: duplicateNames.join(", ") }));
      return;
    }
    setSavingTeams(true);
    await patch({ teamsSnapshot: editableTeams });
    setSavingTeams(false);
    setTeamsDirty(false);
  };

  const handleDragStart = (playerName: string, fromTeam: number) => setDragPlayer({ name: playerName, fromTeam });
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; };
  const handleDrop = (targetTeam: number) => {
    if (!dragPlayer || dragPlayer.fromTeam === targetTeam) { setDragPlayer(null); return; }
    setEditableTeams((prev) => prev.map((t, i) => {
      if (i === dragPlayer.fromTeam) {
        const filtered = t.players.filter((p) => p.name !== dragPlayer.name);
        return { ...t, players: filtered.map((p, j) => ({ ...p, order: j })) };
      }
      if (i === targetTeam) {
        return { ...t, players: [...t.players, { name: dragPlayer.name, order: t.players.length }] };
      }
      return t;
    }));
    setTeamsDirty(true);
    setDragPlayer(null);
  };

  // ── Payments edit (auto-save on click, no manual save) ─────────────────────
  const paymentSaveInFlight = useRef<Set<number>>(new Set());
  const cyclePaymentStatus = async (idx: number) => {
    // Prevent double-fire on the same chip while a PATCH is in flight
    if (paymentSaveInFlight.current.has(idx)) return;

    const order: Array<"paid" | "pending"> = ["pending", "paid"];
    let nextSnapshot: PaymentSnapshotEntry[] = [];
    setEditablePayments((prev) => {
      nextSnapshot = prev.map((p, i) => {
        if (i !== idx) return p;
        const next = order[(order.indexOf(p.status) + 1) % order.length];
        return { ...p, status: next };
      });
      return nextSnapshot;
    });

    paymentSaveInFlight.current.add(idx);
    await patch({ paymentsSnapshot: nextSnapshot });
    paymentSaveInFlight.current.delete(idx);
  };

  // ── MVP vote ───────────────────────────────────────────────────────────────
  const handleVote = async (targetParticipant: { id: string; name: string }, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isAuthenticated || !mvpState?.isVotingOpen || votingFor) return;
    setVotingFor(targetParticipant.id);
    try {
      const res = await fetch(`/api/events/${eventId}/history/${entry.id}/mvp-vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ votedForPlayerId: targetParticipant.id, votedForName: targetParticipant.name }),
      });
      if (res.ok) {
        // Refresh mvp state
        const mvpRes = await fetch(`/api/events/${eventId}/history/${entry.id}/mvp`);
        if (mvpRes.ok) setMvpState(await mvpRes.json());
      } else {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Vote failed");
      }
    } catch { /* ignore */ }
    setVotingFor(null);
  };

  // ── Cost display ───────────────────────────────────────────────────────────
  const costTotal = cost?.totalAmount ?? null;
  const costCurrency = cost?.currency ?? "EUR";
  const costPerPlayer = (() => {
    if (!cost || !cost.payments.length) return null;
    const sum = cost.payments.reduce((acc, p) => acc + p.amount, 0);
    return sum / cost.payments.length;
  })();
  const CURRENCY_SYMBOLS: Record<string, string> = { EUR: "€", USD: "$", GBP: "£", BRL: "R$" };
  const formatAmount = (n: number) => {
    const sym = CURRENCY_SYMBOLS[costCurrency] ?? `${costCurrency} `;
    return `${sym}${n % 1 === 0 ? n : n.toFixed(2)}`;
  };

  // Build per-player row data
  type PlayerRow = {
    name: string;
    teamIdx: number;
    elo: number | null;
    paid: "paid" | "pending" | null;
    amount: number | null;
    participant: { id: string; name: string; voteCount: number } | null;
    isMvp: boolean;
  };
  const playerRowsByTeam = useMemo(() => {
    const mvpIdSet = new Set((mvpState?.mvp ?? []).map((m) => m.playerId));
    const participantsByName = new Map(
      (mvpState?.participants ?? []).map((p) => [p.name.toLowerCase(), p]),
    );
    const paymentsByName = new Map(
      (canEditPayments ? editablePayments : payments).map((p) => [p.playerName.toLowerCase(), p]),
    );
    const eloByName = new Map<string, number>();
    // Saved ELO is the source of truth for past games. Only fall back to live
    // preview when the user is mid-edit and saved data isn't present.
    for (const e of entry.eloUpdates ?? []) eloByName.set(e.name, e.delta);
    if (eloByName.size === 0) {
      for (const e of liveEloUpdates) eloByName.set(e.name, e.delta);
    }
    return (canEditTeams ? editableTeams : teams).map((team, teamIdx) => ({
      teamName: team.team,
      rows: team.players.map<PlayerRow>((p) => {
        const participant = participantsByName.get(p.name.toLowerCase()) ?? null;
        const payment = paymentsByName.get(p.name.toLowerCase()) ?? null;
        return {
          name: p.name,
          teamIdx,
          elo: eloByName.get(p.name) ?? null,
          paid: payment?.status ?? null,
          amount: payment?.amount ?? null,
          participant,
          isMvp: participant ? mvpIdSet.has(participant.id) : false,
        };
      }),
    }));
  }, [
    canEditTeams, canEditPayments,
    editableTeams, teams,
    editablePayments, payments,
    liveEloUpdates, entry.eloUpdates,
    mvpState,
  ]);

  const localeStr = locale === "pt" ? "pt-PT" : "en-GB";

  return (
    <Paper elevation={0}
      data-testid="history-card"
      sx={{
        borderRadius: 4,
        overflow: "hidden",
        opacity: isCancelled ? 0.7 : 1,
        border: `1px solid ${alpha(theme.palette.divider, 0.12)}`,
        transition: "box-shadow 0.2s",
        "&:hover": { boxShadow: theme.shadows[4] },
      }}>
      {/* ── Hero + Score zone (continuous, no divider) ── */}
      <Box sx={{
        background: `linear-gradient(135deg, ${alpha(
          isCancelled ? theme.palette.error.main : theme.palette.success.main, 0.08,
        )}, ${alpha(theme.palette.background.paper, 0)})`,
        pt: 2.5, pb: isCancelled ? 2.5 : 0, px: 3,
      }}>
        {/* Top context: event title + admin */}
        <Stack direction="row" alignItems="center" gap={1.5}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0, flex: 1, overflow: "hidden" }}>
            <SportsIcon fontSize="small" sx={{ color: "text.secondary", flexShrink: 0 }} />
            <Typography variant="subtitle1" fontWeight={700} sx={{ lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {event.title}
            </Typography>
          </Stack>

          <Stack direction="row" spacing={0.25} alignItems="center">
            {isPlayAdmin && (
              <>
                {/* ponytail: direct lock toggle gives immediate visual feedback — the kebab menu version remains for discoverability */}
                <Tooltip title={entry.editable ? t("lockAction") : t("unlockAction")}>
                  <span>
                    <IconButton
                      data-testid="lock-toggle-inline"
                      size="small"
                      color={entry.editable ? "default" : "warning"}
                      onClick={handleToggleLock}
                      disabled={unlocking}
                    >
                      {entry.editable ? <LockOpenIcon fontSize="small" /> : <LockIcon fontSize="small" />}
                    </IconButton>
                  </span>
                </Tooltip>
                <Tooltip title={entry.isFriendly ? t("markCompetitive") : t("markFriendly")}>
                  <span>
                    <IconButton
                      data-testid="friendly-toggle"
                      size="small"
                      color={entry.isFriendly ? "success" : "default"}
                      onClick={handleToggleFriendly}
                      disabled={togglingFriendly}
                    >
                      <SentimentSatisfiedAltIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
                <Tooltip title={t("moreActions")}>
                  <IconButton
                    data-testid="more-actions"
                    size="small"
                    onClick={(e) => setMoreMenuAnchor(e.currentTarget)}
                  >
                    <MoreVertIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Menu
                  anchorEl={moreMenuAnchor}
                  open={!!moreMenuAnchor}
                  onClose={() => setMoreMenuAnchor(null)}
                >
                  <MenuItem
                    data-testid="lock-toggle"
                    onClick={() => { setMoreMenuAnchor(null); handleToggleLock(); }}
                    disabled={unlocking}
                  >
                    <ListItemIcon>
                      {entry.editable ? <LockOpenIcon fontSize="small" /> : <LockIcon fontSize="small" />}
                    </ListItemIcon>
                    <ListItemText>{entry.editable ? t("lockAction") : t("unlockAction")}</ListItemText>
                  </MenuItem>
                  <MenuItem
                    data-testid="delete-action"
                    onClick={() => { setMoreMenuAnchor(null); setConfirmDelete(true); }}
                    disabled={deleting}
                    sx={{ color: "error.main" }}
                  >
                    <ListItemIcon>
                      <DeleteIcon fontSize="small" color="error" />
                    </ListItemIcon>
                    <ListItemText>{t("deleteGame")}</ListItemText>
                  </MenuItem>
                </Menu>
              </>
            )}
            {!isPlayAdmin && !entry.editable && (
              <Tooltip title={t("notEditable")}>
                <LockIcon fontSize="small" color="disabled" />
              </Tooltip>
            )}
          </Stack>
        </Stack>

        {/* Date row */}
        <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mt: 0.5 }}>
          <EventIcon fontSize="small" sx={{ color: "text.disabled" }} />
          <Typography variant="body2" color="text.secondary">
            {formatDateInTz(date, localeStr, event.timezone, {
              weekday: "short", day: "numeric", month: "short", year: "numeric",
            })}
            {" · "}
            {formatDateInTz(date, localeStr, event.timezone, { hour: "2-digit", minute: "2-digit" })}
          </Typography>
        </Stack>

        {/* Meta row: location + cost + share + source */}
        <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" sx={{ mt: 0.5, rowGap: 0.5 }}>
          {entry.source === "historical" && (
            <Tooltip title={t("historicalGame")}>
              <Chip icon={<HistoryIcon color="primary" />} label={t("historicalGame")}
                color="warning" size="small" variant="outlined" sx={{ fontWeight: 600, height: 22 }} />
            </Tooltip>
          )}
          {event.location ? (
            <Tooltip title={t("getDirections")}>
              <a href={mapsUrl(event.location, event.latitude, event.longitude)}
                target="_blank" rel="noopener noreferrer"
                style={{ color: "inherit", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4, minWidth: 0, maxWidth: "60%" }}>
                <LocationOnIcon fontSize="small" sx={{ color: "primary.main", flexShrink: 0 }} />
                <Typography variant="body2" color="text.secondary" noWrap sx={{ textDecoration: "underline", textDecorationStyle: "dotted" }}>
                  {event.location}
                </Typography>
              </a>
            </Tooltip>
          ) : isPlayAdmin ? (
            <Button size="small" variant="text" startIcon={<LocationOnIcon />}
              href={`/events/${eventId}`}
              sx={{ textTransform: "none", minWidth: 0, p: 0.5, color: "text.secondary" }}>
              {t("addLocationInline")}
            </Button>
          ) : (
            <Typography variant="body2" color="text.disabled">{t("noLocationSet")}</Typography>
          )}

          {cost && costTotal !== null ? (
            <Tooltip title={t("totalCost")}>
              <Stack direction="row" spacing={0.5} alignItems="center">
                <AttachMoneyIcon fontSize="small" sx={{ color: "success.main" }} />
                <Typography variant="body2" color="text.secondary">
                  {costTotal.toFixed(2)} {costCurrency}
                  {costPerPlayer !== null && costPerPlayer > 0 && (
                    <> · <strong>{costPerPlayer.toFixed(2)} {costCurrency}</strong>/player</>
                  )}
                </Typography>
              </Stack>
            </Tooltip>
          ) : isPlayAdmin ? (
            <Button size="small" variant="text" startIcon={<AttachMoneyIcon />}
              href={`/events/${eventId}`}
              sx={{ textTransform: "none", minWidth: 0, p: 0.5, color: "text.secondary" }}>
              {t("addCostInline")}
            </Button>
          ) : null}
        </Stack>

        {/* Score band — same hero zone, no divider */}
        {!isCancelled ? (
          <Box sx={{ pt: 2.5, pb: 1 }}>
            <Box sx={{
              display: "grid",
              gridTemplateColumns: "1fr auto 1fr",
              alignItems: "center",
              gap: { xs: 1.5, sm: 3 },
            }}>
              {/* Team 1 */}
              <Stack alignItems={{ xs: "center", sm: "flex-end" }} spacing={0} sx={{ minWidth: 0 }}>
                <Typography
                  variant="h6"
                  fontWeight={700}
                  sx={{ lineHeight: 1.1, fontSize: { xs: "1rem", sm: "1.15rem" }, textAlign: { xs: "center", sm: "right" } }}
                >
                  {entry.teamOneName}
                </Typography>
                {canEditScore && (
                  <Typography variant="caption" color="text.disabled" sx={{ textAlign: { xs: "center", sm: "right" } }}>
                    {scoreOne !== "" ? scoreOne : "0"}
                  </Typography>
                )}
              </Stack>

              {/* Score */}
              {canEditScore ? (
                <Box
                  sx={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 0.5,
                    borderRadius: 999,
                    border: `1px solid ${theme.palette.divider}`,
                    bgcolor: theme.palette.action.hover,
                    px: 0.5, py: 0.25,
                  }}
                >
                  <IconButton data-testid="score-minus" size="small" onClick={() => setScoreOne(String(Math.max(0, (parseInt(scoreOne, 10) || 0) - 1)))} sx={{ p: 0.5 }}>
                    <RemoveIcon fontSize="small" />
                  </IconButton>
                  <Typography sx={{ fontSize: { xs: "1.75rem", sm: "2rem" }, fontWeight: 800, fontVariantNumeric: "tabular-nums", lineHeight: 1, minWidth: "2ch", textAlign: "center", px: 1 }}>
                    {(scoreOne || "0").padStart(2, "0")}
                  </Typography>
                  <IconButton data-testid="score-plus" size="small" color="primary" onClick={() => setScoreOne(String((parseInt(scoreOne, 10) || 0) + 1))} sx={{ p: 0.5 }}>
                    <AddIcon fontSize="small" />
                  </IconButton>
                  <Typography variant="h4" color="text.disabled" fontWeight={300} sx={{ mx: -1 }}>-</Typography>
                  <IconButton size="small" onClick={() => setScoreTwo(String(Math.max(0, (parseInt(scoreTwo, 10) || 0) - 1)))} sx={{ p: 0.5 }}>
                    <RemoveIcon fontSize="small" />
                  </IconButton>
                  <Typography sx={{ fontSize: { xs: "1.75rem", sm: "2rem" }, fontWeight: 800, fontVariantNumeric: "tabular-nums", lineHeight: 1, minWidth: "2ch", textAlign: "center", px: 1 }}>
                    {(scoreTwo || "0").padStart(2, "0")}
                  </Typography>
                  <IconButton size="small" color="primary" onClick={() => setScoreTwo(String((parseInt(scoreTwo, 10) || 0) + 1))} sx={{ p: 0.5 }}>
                    <AddIcon fontSize="small" />
                  </IconButton>
                </Box>
              ) : (
                <Typography
                  variant="h2"
                  fontWeight={800}
                  sx={{
                    fontSize: { xs: "2.75rem", sm: "3.5rem" },
                    fontVariantNumeric: "tabular-nums",
                    lineHeight: 1,
                    color: "text.primary",
                    whiteSpace: "nowrap",
                  }}
                >
                  {entry.scoreOne ?? 0}-{entry.scoreTwo ?? 0}
                </Typography>
              )}

              {/* Team 2 */}
              <Stack alignItems={{ xs: "center", sm: "flex-start" }} spacing={0} sx={{ minWidth: 0 }}>
                <Typography
                  variant="h6"
                  fontWeight={700}
                  sx={{ lineHeight: 1.1, fontSize: { xs: "1rem", sm: "1.15rem" }, textAlign: { xs: "center", sm: "left" } }}
                >
                  {entry.teamTwoName}
                </Typography>
                {canEditScore && (
                  <Typography variant="caption" color="text.disabled" sx={{ textAlign: { xs: "center", sm: "left" } }}>
                    {scoreTwo !== "" ? scoreTwo : "0"}
                  </Typography>
                )}
              </Stack>
            </Box>

            {/* Status: small text below score, like FotMob "Full time" */}
          </Box>
        ) : null}

        {/* Status row — always shown (Played / Cancelled / Upcoming) */}
        <Box sx={{ display: "flex", justifyContent: "center", pb: 2 }}>
          <Typography
            data-testid="status-chip"
            variant="caption"
            component="span"
            onClick={entry.editable && isAuthenticated ? (e) => setStatusMenuAnchor(e.currentTarget) : undefined}
            sx={{
              color: isCancelled ? "error.main" : "success.main",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: 0.5,
              cursor: entry.editable && isAuthenticated ? "pointer" : "default",
              userSelect: "none",
            }}
          >
            {isCancelled ? t("statusCancelled") : t("statusPlayed")}
          </Typography>
        </Box>
        <Menu
          anchorEl={statusMenuAnchor}
          open={!!statusMenuAnchor}
          onClose={() => setStatusMenuAnchor(null)}
        >
          {(["played", "cancelled", "upcoming"] as const).map((s) => (
            <MenuItem key={s} data-testid={`status-option-${s}`} onClick={() => handleStatusChange(s)}
              selected={entry.status === s}>
              <ListItemIcon>
                {s === "played" && <CheckCircleIcon fontSize="small" color="success" />}
                {s === "cancelled" && <CancelIcon fontSize="small" color="error" />}
                {s === "upcoming" && <SportsIcon fontSize="small" color="action" />}
              </ListItemIcon>
              <ListItemText>{s === "played" ? t("statusPlayed") : s === "cancelled" ? t("statusCancelled") : t("statusUpcoming")}</ListItemText>
            </MenuItem>
          ))}
        </Menu>
      </Box>

      {/* Delete confirmation dialog */}
      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t("deleteGame")}</DialogTitle>
        <DialogContent>
          <Typography>{t("deleteHistoryConfirm")}</Typography>
          {entry.eloProcessed && (
            <Alert severity="warning" sx={{ mt: 2, borderRadius: 2 }}>
              {t("deleteHistoryEloWarning")}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDelete(false)} disabled={deleting}>{t("cancel")}</Button>
          <Button color="error" variant="contained" onClick={handleDelete} disabled={deleting}>
            {deleting ? t("deleting") : t("deleteGame")}
          </Button>
        </DialogActions>
      </Dialog>

      <Stack spacing={0}>
        {error && (
          <Box sx={{ px: 3, pt: 2 }}>
            <Alert severity="error" onClose={() => setError(null)} sx={{ borderRadius: 2 }}>{error}</Alert>
          </Box>
        )}

        {/* ── ELO Approval for Historical Games ── */}
        {entry.source === "historical" && !isCancelled && (
          <Box sx={{ px: 3, py: 2.5 }}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
              <EmojiEventsIcon fontSize="small" sx={{ color: entry.eloProcessed ? "success.main" : "warning.main" }} />
              <Typography variant="subtitle2" fontWeight={700} textTransform="uppercase" letterSpacing={0.5} color="text.secondary">
                {entry.eloProcessed ? t("eloApproved") : t("eloPending")}
              </Typography>
              {!entry.eloProcessed && isPlayAdmin && (
                <Button size="small" variant="contained" disableElevation startIcon={<EmojiEventsIcon />}
                  onClick={handleApproveElo} disabled={approvingElo} sx={{ ml: "auto", borderRadius: 2, textTransform: "none", fontWeight: 600 }}>
                  {approvingElo ? t("approvingElo") : t("approveElo")}
                </Button>
              )}
            </Stack>
            <Alert severity={entry.eloProcessed ? "success" : "warning"} sx={{ borderRadius: 2 }}>
              {entry.eloProcessed ? t("eloApprovedSuccess") : t("eloPending")}
            </Alert>
          </Box>
        )}

        {/* ── Players stream (teams + payments + mvp) ── */}
        {playerRowsByTeam.length > 0 && !isCancelled && (
          <Box sx={{ px: 3, py: 2 }}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
              <SportsIcon fontSize="small" sx={{ color: "text.secondary" }} />
              <Typography variant="subtitle2" fontWeight={700} textTransform="uppercase" letterSpacing={0.5} color="text.secondary">
                {t("players")}
              </Typography>
              {canEditTeams && teamsDirty && (
                <Button size="small" variant="contained" disableElevation
                  onClick={handleSaveTeams} disabled={savingTeams || duplicateNames.length > 0}
                  sx={{ ml: "auto", borderRadius: 2, textTransform: "none", fontWeight: 600 }}>
                  {savingTeams ? t("savingDateTime") : t("saveTeams")}
                </Button>
              )}
            </Stack>

            {duplicateNames.length > 0 && (
              <Alert severity="warning" sx={{ mb: 1.5, borderRadius: 2 }}>
                {t("duplicatePlayerWarning", { names: duplicateNames.join(", ") })}
              </Alert>
            )}

            <Box sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
              gap: 1.5,
            }}>
              {playerRowsByTeam.map((team, teamIdx) => {
                // Win/loss tint: green for winners, red for losers, none for draw
                const isWinner = entry.scoreOne !== null && entry.scoreTwo !== null && (
                  (teamIdx === 0 && entry.scoreOne > entry.scoreTwo) ||
                  (teamIdx === 1 && entry.scoreTwo > entry.scoreOne)
                );
                const isLoser = entry.scoreOne !== null && entry.scoreTwo !== null && (
                  (teamIdx === 0 && entry.scoreOne < entry.scoreTwo) ||
                  (teamIdx === 1 && entry.scoreTwo < entry.scoreOne)
                );
                const tintColor = isWinner
                  ? alpha(theme.palette.success.main, 0.06)
                  : isLoser
                    ? alpha(theme.palette.error.main, 0.04)
                    : "transparent";
                const borderColor = isWinner
                  ? theme.palette.success.main
                  : isLoser
                    ? theme.palette.error.main
                    : "transparent";
                return (
                <Stack
                  key={team.teamName}
                  spacing={0.25}
                  onDragOver={canEditTeams ? handleDragOver : undefined}
                  onDrop={canEditTeams ? () => handleDrop(teamIdx) : undefined}
                  sx={{
                    borderRadius: 2,
                    px: 1,
                    py: 0.5,
                    backgroundColor: (canEditTeams && dragPlayer && dragPlayer.fromTeam !== teamIdx)
                      ? alpha(theme.palette.primary.main, 0.04)
                      : tintColor,
                    borderTop: { sm: `3px solid ${borderColor}` },
                    transition: "background-color 0.2s",
                  }}
                >
                    {team.rows.map((row) => {
                      const liveElo = liveEloUpdates.find((e) => e.name === row.name);
                      const elo = row.elo ?? liveElo?.delta ?? null;
                      const eloColor = elo === null ? "default" : elo > 0 ? "success" : elo < 0 ? "error" : "default";
                      return (
                        <Box key={row.name} data-player-row={row.name}
                          draggable={canEditTeams}
                          onDragStart={canEditTeams ? () => handleDragStart(row.name, teamIdx) : undefined}
                          sx={{
                            display: "grid",
                            gridTemplateColumns: "1fr auto auto auto auto",
                            alignItems: "center",
                            gap: 1,
                            py: 0.25, px: 1, borderRadius: 1.5,
                            ...(canEditTeams ? { cursor: "grab", "&:active": { cursor: "grabbing" } } : {}),
                          }}>
                          <Typography variant="body2" sx={{ fontWeight: 500, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {row.name}
                            {canEditTeams && (
                              <IconButton size="small" onClick={() => removePlayerFromTeam(teamIdx, row.name)}
                                sx={{ ml: 0.25, p: 0, verticalAlign: "middle" }}>
                                <CancelIcon sx={{ fontSize: 12 }} color="error" />
                              </IconButton>
                            )}
                          </Typography>

                          {/* ELO chip — hidden on friendly games, no rating change */}
                          {entry.isFriendly ? (
                            <Tooltip title={t("friendlyNoElo")}>
                              <Chip size="small" label={t("noElo")}
                                variant="outlined"
                                sx={{ height: 22, fontSize: "0.8rem", color: "text.disabled", borderColor: "divider" }} />
                            </Tooltip>
                          ) : elo !== null ? (
                            <EloChipWithPopover
                              label={elo >= 0 ? `+${elo}` : `${elo}`}
                              color={eloColor as "success" | "error" | "default"}
                              variant={elo === 0 ? "outlined" : "filled"}
                              tooltipText={eloTooltipText(t, row.name, elo, teams, playerRatings, entry.scoreOne, entry.scoreTwo)}
                            />
                          ) : (
                            <Box /> /* keep grid alignment */
                          )}

                          {/* Payment chip */}
                          {row.paid && row.amount !== null ? (
                            <Chip size="small"
                              label={`${formatAmount(row.amount)}`}
                              color={row.paid === "paid" ? "success" : "warning"}
                              variant={row.paid === "paid" ? "filled" : "outlined"}
                              onClick={canEditPayments ? () => {
                                const idx = (canEditPayments ? editablePayments : payments).findIndex((p) => p.playerName === row.name);
                                if (idx >= 0) cyclePaymentStatus(idx);
                              } : undefined}
                              icon={row.paid === "paid" ? <CheckCircleIcon sx={{ fontSize: 12 }} /> : undefined}
                              sx={{ height: 22, fontSize: "0.8rem", fontWeight: 600,
                                ...(canEditPayments ? { cursor: "pointer" } : {}) }} />
                          ) : (
                            <Box /> /* keep grid alignment */
                          )}

                          {/* MVP vote crown */}
                          {mvpState && isParticipantInGame && mvpState.isVotingOpen && row.participant && row.participant.id !== `name:${userName ?? ""}` ? (
                            <Tooltip title={mvpState.hasVoted ? t("mvpChangeVote") : t("voteMvp")}>
                              <IconButton size="small" onClick={(e) => row.participant && handleVote(row.participant!, e)}
                                disabled={votingFor !== null}
                                sx={{ p: 0, minWidth: 0 }}>
                                {row.isMvp ? (
                                  <EmojiEventsIcon sx={{ fontSize: 14, color: "warning.main" }} />
                                ) : (
                                  <EmojiEventsIcon sx={{ fontSize: 14, color: "action.active" }} />
                                )}
                              </IconButton>
                            </Tooltip>
                          ) : mvpState && isParticipantInGame && mvpState.isVotingOpen && row.participant && row.participant.id === `name:${userName ?? ""}` ? (
                            <Tooltip title={t("mvpSelfVoteError")}>
                              <span>
                                <IconButton size="small" disabled sx={{ p: 0, minWidth: 0 }}>
                                  <EmojiEventsIcon sx={{ fontSize: 14, color: "action.disabled" }} />
                                </IconButton>
                              </span>
                            </Tooltip>
                          ) : (
                            <Box /> /* keep grid alignment */
                          )}

                          {/* MVP count badge (always visible if voting happened) */}
                          {row.participant && row.participant.voteCount > 0 ? (
                            <Typography variant="caption" color="warning.main" fontWeight={700} sx={{ minWidth: 16, textAlign: "right" }}>
                              {row.participant.voteCount}
                            </Typography>
                          ) : (
                            <Box /> /* keep grid alignment */
                          )}
                        </Box>
                      );
                    })}

                  {/* Add player (only when editing) */}
                  {canEditTeams && (
                    <Box sx={{ mt: 1 }}>
                      <Autocomplete<PlayerOption, false, false, true>
                        freeSolo size="small"
                        options={(() => {
                          const trimmed = (newPlayerInputs[teamIdx] ?? "").trim();
                          const currentNames = new Set(team.rows.map((r) => r.name.toLowerCase()));
                          const available = knownPlayers.filter((kp) => !currentNames.has(kp.name.toLowerCase()));
                          const filtered: PlayerOption[] = available
                            .filter((s) => matchesWithName(s.name, trimmed))
                            .map((s) => ({ type: "existing" as const, name: s.name, gamesPlayed: s.gamesPlayed, userId: s.userId ?? null }));
                          if (trimmed && !filtered.some((o) => o.name.toLowerCase() === trimmed.toLowerCase())) {
                            filtered.push({ type: "create" as const, name: trimmed });
                          }
                          return filtered;
                        })()}
                        filterOptions={(options) => options}
                        getOptionLabel={(option) => typeof option === "string" ? option : option.name}
                        isOptionEqualToValue={(option, value) =>
                          typeof option !== "string" && typeof value !== "string" && option.type === value.type && option.name === value.name}
                        value={null}
                        inputValue={newPlayerInputs[teamIdx] ?? ""}
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
                          <TextField {...params} placeholder={t("addPlayerToTeam")}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && (newPlayerInputs[teamIdx] ?? "").trim()) {
                                e.preventDefault();
                                e.stopPropagation();
                                addPlayerToTeam(teamIdx, (newPlayerInputs[teamIdx] ?? "").trim());
                                setNewPlayerInputs((prev) => ({ ...prev, [teamIdx]: "" }));
                              }
                            }}
                            sx={{ "& .MuiOutlinedInput-root": { borderRadius: 2 } }}
                            slotProps={{
                              input: {
                                ...params.slotProps.input,
                                endAdornment: (
                                  <InputAdornment position="end">
                                    <IconButton size="small" color="primary" edge="end"
                                      disabled={!(newPlayerInputs[teamIdx] ?? "").trim()}
                                      onClick={() => {
                                        addPlayerToTeam(teamIdx, (newPlayerInputs[teamIdx] ?? "").trim());
                                        setNewPlayerInputs((prev) => ({ ...prev, [teamIdx]: "" }));
                                      }}>
                                      <PersonAddIcon fontSize="small" />
                                    </IconButton>
                                  </InputAdornment>
                                ),
                              },
                              htmlInput: { ...params.slotProps.htmlInput, maxLength: 50 },
                            }} />
                        )}
                          noOptionsText={t("noSuggestions")}
                        />
                      </Box>
                    )}
                </Stack>
                );
              })}
            </Box>
          </Box>
        )}

        {/* ── Editable info footer ── */}
        {canEditScore && (
          <Box sx={{ px: 3, py: 2 }}>
            <Typography variant="caption" color="text.disabled" sx={{ display: "block", textAlign: "right" }}>
              {t("editableUntil", {
                date: formatDateInTz(editableUntil, localeStr, event.timezone, {
                  day: "numeric", month: "short", year: "numeric",
                }),
              })}
            </Typography>
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
