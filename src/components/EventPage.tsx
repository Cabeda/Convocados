import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import useSWR from "swr";
import {
  Container, Paper, Typography, TextField, Button, Box, Stack, Chip,
  Alert, IconButton, Tooltip, InputAdornment, Dialog, DialogTitle,
  DialogContent, DialogContentText, DialogActions, Snackbar, alpha, useTheme, Grid2,
  CircularProgress, Divider, Autocomplete, Accordion, AccordionSummary, AccordionDetails,
  FormControlLabel, Switch, FormControl, Select, MenuItem, List, ListItem, ListItemText,
} from "@mui/material";
import PersonAddIcon from "@mui/icons-material/PersonAdd";
import HistoryIcon from "@mui/icons-material/History";
import ShuffleIcon from "@mui/icons-material/Shuffle";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import ShareIcon from "@mui/icons-material/Share";
import EditIcon from "@mui/icons-material/Edit";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import AccessTimeIcon from "@mui/icons-material/AccessTime";
import LocationOnIcon from "@mui/icons-material/LocationOn";
import EventRepeatIcon from "@mui/icons-material/EventRepeat";
import EmojiPeopleIcon from "@mui/icons-material/EmojiPeople";
import AirlineSeatReclineNormalIcon from "@mui/icons-material/AirlineSeatReclineNormal";
import NotificationsIcon from "@mui/icons-material/Notifications";
import NotificationsOffIcon from "@mui/icons-material/NotificationsOff";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import IntegrationInstructionsIcon from "@mui/icons-material/IntegrationInstructions";
import PublicIcon from "@mui/icons-material/Public";
import SportsSoccerIcon from "@mui/icons-material/SportsSoccer";
import ShieldIcon from "@mui/icons-material/Shield";
import SwapHorizIcon from "@mui/icons-material/SwapHoriz";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import StarIcon from "@mui/icons-material/Star";
import CalendarMonthIcon from "@mui/icons-material/CalendarMonth";
import SettingsIcon from "@mui/icons-material/Settings";
import { ThemeModeProvider } from "./ThemeModeProvider";
import { ResponsiveLayout } from "./ResponsiveLayout";
import { TeamPicker } from "./TeamPicker";
import type { Imatch } from "~/lib/random";
import { describeRecurrenceRule, parseRecurrenceRule } from "~/lib/recurrence";
import { useT } from "~/lib/useT";
import { detectLocale } from "~/lib/i18n";
import { matchesWithName } from "~/lib/stringMatch";
import { getKnownNames, addKnownName, getQjName, setQjName } from "~/lib/knownNames";
import { SPORT_PRESETS, getSportPreset, getDefaultMaxPlayers } from "~/lib/sports";
import { useSession } from "~/lib/auth.client";
import { googleCalendarUrl } from "~/lib/calendar";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Player { id: string; name: string; userId?: string | null; }
interface TeamMember { name: string; order: number; }
interface TeamResult { id: string; name: string; members: TeamMember[]; }

interface EventData {
  id: string;
  title: string;
  location: string;
  dateTime: string;
  maxPlayers: number;
  teamOneName: string;
  teamTwoName: string;
  isRecurring: boolean;
  isPublic: boolean;
  balanced: boolean;
  sport: string;
  recurrenceRule: string | null;
  ownerId: string | null;
  ownerName: string | null;
  players: Player[];
  teamResults: TeamResult[];
  wasReset?: boolean;
}

// ── Countdown ─────────────────────────────────────────────────────────────────

function useCountdown(target: Date, gameTimeLabel: string) {
  const [diff, setDiff] = useState(() => target.getTime() - Date.now());
  useEffect(() => {
    const id = setInterval(() => setDiff(target.getTime() - Date.now()), 1000);
    return () => clearInterval(id);
  }, [target]);

  if (diff <= 0) return gameTimeLabel;
  const s = Math.floor(diff / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  return `${m}m ${sec}s`;
}

// ── Inline edit ───────────────────────────────────────────────────────────────

function InlineEdit({ value, onSave, label }: { value: string; onSave: (v: string) => void; label: string }) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const commit = () => { onSave(draft.trim() || value); setEditing(false); };

  if (!editing) return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
      <Typography variant="h5" fontWeight={700}>{value}</Typography>
      <Tooltip title={t("renameTeam", { label })}>
        <IconButton size="small" onClick={() => { setDraft(value); setEditing(true); }}>
          <EditIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </Box>
  );

  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
      <TextField size="small" value={draft} autoFocus
        onChange={(e) => setDraft(e.target.value.slice(0, 50))}
        onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
        inputProps={{ maxLength: 50 }} />
      <IconButton size="small" color="primary" onClick={commit}><CheckIcon fontSize="small" /></IconButton>
      <IconButton size="small" onClick={() => setEditing(false)}><CloseIcon fontSize="small" /></IconButton>
    </Box>
  );
}

// ── Notify button ─────────────────────────────────────────────────────────────

function NotifyButton({ eventId }: { eventId: string }) {
  const t = useT();
  const [state, setState] = useState<"idle" | "subscribed" | "denied" | "unsupported">("idle");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setState("unsupported"); return;
    }
    if (Notification.permission === "denied") { setState("denied"); return; }
    navigator.serviceWorker.ready.then((reg) => {
      reg.pushManager.getSubscription().then((sub) => {
        if (sub) setState("subscribed");
      });
    });
  }, []);

  const subscribe = async () => {
    setLoading(true);
    try {
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const keyRes = await fetch("/api/push/vapid-public-key");
      const { publicKey } = await keyRes.json();
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: publicKey,
      });
      await fetch(`/api/events/${eventId}/push`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...sub.toJSON(),
          locale: navigator.language,
          clientId: localStorage.getItem("client_id") ?? "",
        }),
      });
      setState("subscribed");
    } catch (err: any) {
      if (Notification.permission === "denied") setState("denied");
    } finally {
      setLoading(false);
    }
  };

  const unsubscribe = async () => {
    setLoading(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch(`/api/events/${eventId}/push`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setState("idle");
    } finally {
      setLoading(false);
    }
  };

  if (state === "unsupported") return null;

  if (state === "denied") return (
    <Tooltip title={t("notifyDenied")}>
      <span>
        <Button variant="outlined" size="small" disabled startIcon={<NotificationsOffIcon />} sx={{ flexShrink: 0 }}>
          {t("notifyDenied")}
        </Button>
      </span>
    </Tooltip>
  );

  if (state === "subscribed") return (
    <Button variant="outlined" size="small" color="success" startIcon={<NotificationsIcon />}
      onClick={unsubscribe} disabled={loading} sx={{ flexShrink: 0 }}>
      {t("notifyEnabled")}
    </Button>
  );

  return (
    <Button variant="outlined" size="small" startIcon={<NotificationsIcon />}
      onClick={subscribe} disabled={loading} sx={{ flexShrink: 0 }}>
      {t("notifySubscribe")}
    </Button>
  );
}

// ── Share bar ─────────────────────────────────────────────────────────────────

function ShareBar({ title }: { title: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const url = typeof window !== "undefined" ? window.location.href : "";
  const canShare = typeof navigator !== "undefined" && !!navigator.share;

  const handleShare = async () => {
    if (canShare) {
      try {
        await navigator.share({ title, url });
        return;
      } catch {
        // user cancelled or not supported — fall through to clipboard
      }
    }
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  // On mobile with native share, just show a button — no need to display the URL
  if (canShare) {
    return (
      <Button variant="contained" size="small" startIcon={<ShareIcon />} onClick={handleShare} sx={{ flexShrink: 0 }}>
        {t("shareGameMobile")}
      </Button>
    );
  }

  return (
    <Paper variant="outlined" sx={{ borderRadius: 2, p: 1, display: "flex", alignItems: "center", gap: 1, width: "100%" }}>
      <Typography variant="body2" color="text.secondary" sx={{
        flexGrow: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        fontFamily: "monospace", fontSize: "0.75rem", minWidth: 0,
      }}>
        {url}
      </Typography>
      <Button
        variant={copied ? "outlined" : "contained"}
        size="small"
        color={copied ? "success" : "primary"}
        startIcon={copied ? <CheckIcon /> : <ContentCopyIcon />}
        onClick={handleShare}
        sx={{ flexShrink: 0 }}
      >
        {copied ? t("linkCopied") : t("shareGame")}
      </Button>
    </Paper>
  );
}

// ── Webhook info (developer integration) ──────────────────────────────────────

function WebhookInfo({ eventId }: { eventId: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const url = typeof window !== "undefined"
    ? `${window.location.origin}/api/events/${eventId}/webhooks`
    : "";

  const handleCopy = async () => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <Accordion
      disableGutters
      elevation={0}
      sx={{
        "&:before": { display: "none" },
        backgroundColor: "transparent",
      }}
    >
      <AccordionSummary
        expandIcon={<ExpandMoreIcon />}
        sx={{ px: 0, minHeight: 0, "& .MuiAccordionSummary-content": { my: 0.5 } }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <IntegrationInstructionsIcon fontSize="small" color="action" />
          <Typography variant="body2" color="text.secondary">
            {t("integrations")}
          </Typography>
        </Box>
      </AccordionSummary>
      <AccordionDetails sx={{ px: 0, pt: 0 }}>
        <Stack spacing={1}>
          <Typography variant="caption" color="text.secondary">
            {t("webhookHelp")}
          </Typography>
          <Paper variant="outlined" sx={{
            borderRadius: 2, p: 1, display: "flex", alignItems: "center", gap: 1,
          }}>
            <Typography variant="body2" sx={{
              flexGrow: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              fontFamily: "monospace", fontSize: "0.75rem", minWidth: 0,
            }}>
              {url}
            </Typography>
            <Tooltip title={copied ? t("webhookCopied") : t("webhookEndpoint")}>
              <IconButton
                size="small"
                color={copied ? "success" : "default"}
                onClick={handleCopy}
              >
                {copied ? <CheckIcon fontSize="small" /> : <ContentCopyIcon fontSize="small" />}
              </IconButton>
            </Tooltip>
          </Paper>
        </Stack>
      </AccordionDetails>
    </Accordion>
  );
}

// ── Quick join ────────────────────────────────────────────────────────────────

interface KnownPlayer {
  name: string;
  gamesPlayed?: number;
}

function QuickJoin({
  userName,
  players,
  maxPlayers,
  onJoin,
  onLeave,
}: {
  userName: string;
  players: Player[];
  maxPlayers: number;
  onJoin: (name: string, linkToAccount?: boolean) => Promise<void>;
  onLeave: (id: string) => Promise<void>;
}) {
  const t = useT();
  const theme = useTheme();
  const [joining, setJoining] = useState(false);

  const joined = players.find((p) => p.name.toLowerCase() === userName.toLowerCase());
  const isOnBench = joined ? players.indexOf(joined) >= maxPlayers : false;

  const handleJoin = async () => {
    setJoining(true);
    await onJoin(userName, true);
    setJoining(false);
  };

  const handleLeave = async () => {
    if (!joined) return;
    setJoining(true);
    await onLeave(joined.id);
    setJoining(false);
  };

  return (
    <Paper elevation={3} sx={{
      borderRadius: 3, p: { xs: 2, sm: 3 },
      background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.08)}, ${alpha(theme.palette.secondary.main, 0.06)})`,
      border: `1px solid ${alpha(theme.palette.primary.main, 0.2)}`,
    }}>
      <Stack spacing={2}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <EmojiPeopleIcon color="primary" />
          <Typography variant="h6" fontWeight={700}>{t("quickJoinTitle")}</Typography>
        </Box>

        {joined ? (
          <Box sx={{ display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap" }}>
            <Chip
              icon={isOnBench ? <AirlineSeatReclineNormalIcon /> : undefined}
              label={isOnBench ? t("youAreOnBench") : t("youArePlaying", { name: joined.name })}
              color={isOnBench ? "warning" : "success"}
              variant="filled"
            />
            <Button size="small" variant="outlined" color="error" onClick={handleLeave} disabled={joining}>
              {t("quickJoinLeave")}
            </Button>
          </Box>
        ) : (
          <Button
            variant="contained"
            onClick={handleJoin}
            disabled={joining}
            startIcon={<PersonAddIcon />}
          >
            {t("quickJoinBtn")} ({userName})
          </Button>
        )}
      </Stack>
    </Paper>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function EventPage({ eventId }: { eventId: string }) {
  const t = useT();
  const locale = detectLocale();
  const [playerInput, setPlayerInput] = useState("");
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [snackbar, setSnackbar] = useState<string | null>(null);
  const [balanced, setBalanced] = useState(false);
  const [isPublic, setIsPublic] = useState(false);
  const [sport, setSport] = useState("football-5v5");
  const [editingLocation, setEditingLocation] = useState(false);
  const [locationDraft, setLocationDraft] = useState("");
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [relinquishConfirmOpen, setRelinquishConfirmOpen] = useState(false);
  const [claimPlayerConfirmOpen, setClaimPlayerConfirmOpen] = useState(false);
  const [playerToClaim, setPlayerToClaim] = useState<{ id: string; name: string } | null>(null);
  const { data: session } = useSession();

  const handleToggleBalanced = async (newValue: boolean) => {
    setBalanced(newValue);
    await fetch(`/api/events/${eventId}/balanced`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ balanced: newValue }),
    });
    mutate();
  };

  const handleSportChange = async (newSport: string) => {
    setSport(newSport);
    await fetch(`/api/events/${eventId}/sport`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sport: newSport }),
    });
    mutate();
  };

  const handleSaveLocation = async () => {
    setEditingLocation(false);
    const res = await fetch(`/api/events/${eventId}/location`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ location: locationDraft }),
    });
    const data = await res.json();
    if (locationDraft && !data.geocoded) {
      setSnackbar(t("locationNotGeocoded"));
    }
    mutate();
  };

  const handleSaveTitle = async () => {
    const trimmed = titleDraft.trim();
    if (!trimmed) return;
    setEditingTitle(false);
    await fetch(`/api/events/${eventId}/title`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: trimmed }),
    });
    mutate();
  };

  // Fetch ELO ratings when balanced mode is on
  const { data: ratingsResponse } = useSWR<{ data: { name: string; rating: number }[] }>(
    balanced ? `/api/events/${eventId}/ratings?limit=100` : null,
    (url) => fetch(url).then((r) => r.json()),
    { revalidateOnFocus: false },
  );
  const ratingsMap = useMemo(() => {
    if (!ratingsResponse?.data) return undefined;
    const map: Record<string, number> = {};
    for (const r of ratingsResponse.data) map[r.name] = r.rating;
    return map;
  }, [ratingsResponse]);

  // Stable client ID — used to suppress self-notifications
  const clientId = useRef<string>("");
  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    let id = localStorage.getItem("client_id");
    if (!id) { id = crypto.randomUUID(); localStorage.setItem("client_id", id); }
    clientId.current = id;
  }, []);

  const [localMatches, setLocalMatches] = useState<Imatch[] | null>(null);
  const [teamOneName, setTeamOneName] = useState("");
  const [teamTwoName, setTeamTwoName] = useState("");
  const theme = useTheme();

  const fetcher = (url: string) => fetch(url).then((r) => {
    if (r.status === 404) throw { status: 404 };
    return r.json();
  });

  const { data: event, error, isLoading, mutate } = useSWR<EventData>(
    `/api/events/${eventId}`,
    fetcher,
    { revalidateOnFocus: true },
  );

  // SSE: subscribe to real-time updates and trigger SWR revalidation
  useEffect(() => {
    const es = new EventSource(`/api/events/${eventId}/stream`);
    es.addEventListener("update", () => {
      mutate();
    });
    return () => es.close();
  }, [eventId, mutate]);
  
  const { data: knownPlayersData } = useSWR<{ players: KnownPlayer[] }>(
    `/api/events/${eventId}/known-players`,
    (url) => fetch(url).then((r) => r.json()),
    { revalidateOnFocus: false }
  );
  
  const localKnownNames = useMemo(() => getKnownNames(), []);
  
  const mergedSuggestions = useMemo(() => {
    const serverNames = new Map<string, number>();
    for (const p of knownPlayersData?.players ?? []) {
      serverNames.set(p.name, p.gamesPlayed ?? 1);
    }
    for (const n of localKnownNames) {
      if (!serverNames.has(n)) {
        serverNames.set(n, 0);
      }
    }
    const qjName = getQjName().trim();
    const result = Array.from(serverNames.entries())
      .map(([name, gamesPlayed]) => ({ name, gamesPlayed }))
      .sort((a, b) => {
        if (qjName && a.name.toLowerCase() === qjName.toLowerCase()) return -1;
        if (qjName && b.name.toLowerCase() === qjName.toLowerCase()) return 1;
        return b.gamesPlayed - a.gamesPlayed;
      });
    return result;
  }, [knownPlayersData, localKnownNames]);
  
  const currentPlayerNames = useMemo(
    () => new Set((event?.players ?? []).map((p) => p.name.toLowerCase())),
    [event?.players]
  );
  
  const availableSuggestions = useMemo(
    () => mergedSuggestions.filter((s) => !currentPlayerNames.has(s.name.toLowerCase())),
    [mergedSuggestions, currentPlayerNames]
  );

  const notFound = error?.status === 404;

  useEffect(() => {
    if (event) document.title = `${event.title} — Convocados`;
    return () => { document.title = "Convocados"; };
  }, [event?.title]);

  // Sync localMatches from server, but don't clobber an in-progress drag
  const isDragging = useRef(false);
  useEffect(() => {
    if (!event || isDragging.current) return;
    if (event.teamResults.length > 0) {
      setLocalMatches(event.teamResults.map((tr) => ({
        team: tr.name,
        players: tr.members.map((m) => ({ name: m.name, order: m.order })),
      })));
    } else {
      setLocalMatches(null);
    }
    setTeamOneName(event.teamOneName);
    setTeamTwoName(event.teamTwoName);
    setIsPublic(event.isPublic);
    setBalanced(event.balanced);
    setSport(event.sport);
  }, [event]);

  const addPlayer = async (name: string, linkToAccount = false) => {
    if (!name.trim()) return;
    setPlayerError(null);
    const res = await fetch(`/api/events/${eventId}/players`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Client-Id": clientId.current },
      body: JSON.stringify({ name: name.trim().slice(0, 50), linkToAccount }),
    });
    const json = await res.json();
    if (!res.ok) { setPlayerError(json.error); return; }
    addKnownName(name.trim());
    mutate();
  };

  const removePlayer = async (playerId: string) => {
    const res = await fetch(`/api/events/${eventId}/players`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json", "X-Client-Id": clientId.current },
      body: JSON.stringify({ playerId }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.undo) {
        setUndoData({ eventId, ...data.undo });
      }
    }
    mutate();
  };

  // ── Undo remove state ──────────────────────────────────────────────────────
  const [undoData, setUndoData] = useState<{ eventId: string; name: string; order: number; userId: string | null; removedAt: number } | null>(null);

  const handleUndo = useCallback(async () => {
    if (!undoData) return;
    const res = await fetch(`/api/events/${undoData.eventId}/undo-remove`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(undoData),
    });
    if (res.ok) {
      mutate();
    } else {
      const json = await res.json();
      setPlayerError(json.error);
    }
    setUndoData(null);
  }, [undoData, mutate]);

  // Auto-expire undo after 60 seconds
  useEffect(() => {
    if (!undoData) return;
    const timer = setTimeout(() => setUndoData(null), 60_000);
    return () => clearTimeout(timer);
  }, [undoData]);

  const handleClaimPlayerConfirm = async () => {
    if (!playerToClaim) return;
    setClaimPlayerConfirmOpen(false);
    const res = await fetch(`/api/events/${eventId}/claim-player`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId: playerToClaim.id }),
    });
    if (res.ok) {
      setSnackbar(t("claimPlayerSuccess"));
      mutate();
    } else {
      const json = await res.json();
      setPlayerError(json.error);
    }
    setPlayerToClaim(null);
  };

  const openClaimPlayerDialog = (playerId: string, playerName: string) => {
    setPlayerToClaim({ id: playerId, name: playerName });
    setClaimPlayerConfirmOpen(true);
  };

  const claimPlayer = async (playerId: string) => {
    const res = await fetch(`/api/events/${eventId}/claim-player`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId }),
    });
    if (res.ok) {
      setSnackbar(t("claimPlayerSuccess"));
      mutate();
    } else {
      const json = await res.json();
      setPlayerError(json.error);
    }
  };

  // ── Player reorder drag state ──────────────────────────────────────────────
  const [dragPlayer, setDragPlayer] = useState<{ id: string; index: number } | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const reorderPlayers = useCallback(async (reorderedIds: string[]) => {
    await fetch(`/api/events/${eventId}/reorder-players`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerIds: reorderedIds }),
    });
    mutate();
  }, [eventId, mutate]);

  const resetPlayerOrder = useCallback(async () => {
    const res = await fetch(`/api/events/${eventId}/reset-player-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    if (res.ok) mutate();
  }, [eventId, mutate]);

  const handlePlayerDragStart = useCallback((playerId: string, index: number) => {
    setDragPlayer({ id: playerId, index });
  }, []);

  const handlePlayerDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    setDragOverIndex(index);
  }, []);

  const handlePlayerDrop = useCallback((players: Player[]) => {
    if (!dragPlayer || dragOverIndex === null || dragPlayer.index === dragOverIndex) {
      setDragPlayer(null);
      setDragOverIndex(null);
      return;
    }
    const ids = players.map((p) => p.id);
    const [moved] = ids.splice(dragPlayer.index, 1);
    ids.splice(dragOverIndex, 0, moved);
    setDragPlayer(null);
    setDragOverIndex(null);
    reorderPlayers(ids);
  }, [dragPlayer, dragOverIndex, reorderPlayers]);

  const handlePlayerDragEnd = useCallback(() => {
    setDragPlayer(null);
    setDragOverIndex(null);
  }, []);

  const doRandomize = async () => {
    setConfirmOpen(false);
    const qs = balanced ? "?balanced=true" : "";
    const res = await fetch(`/api/events/${eventId}/randomize${qs}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const json = await res.json();
    if (!res.ok) { setPlayerError(json.error); return; }
    mutate();
  };

  const handleTeamChange = async (matches: Imatch[]) => {
    setLocalMatches(matches);
    isDragging.current = true;
    await fetch(`/api/events/${eventId}/teams`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ matches }),
    });
    isDragging.current = false;
    mutate();
  };

  const handleTeamNameSave = async (one: string, two: string) => {
    await fetch(`/api/events/${eventId}/team-names`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ teamOneName: one, teamTwoName: two }),
    });
    mutate();
  };

  const handleTogglePublic = async (newValue: boolean) => {
    setIsPublic(newValue);
    await fetch(`/api/events/${eventId}/visibility`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isPublic: newValue }),
    });
    mutate();
  };

  const gameDate = event ? new Date(event.dateTime) : new Date();
  const countdown = useCountdown(gameDate, t("gameTime"));

  if (isLoading) return (
    <ThemeModeProvider>
      <ResponsiveLayout>
        <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", height: "60vh" }}>
          <CircularProgress />
        </Box>
      </ResponsiveLayout>
    </ThemeModeProvider>
  );

  if (notFound || !event) return (
    <ThemeModeProvider>
      <ResponsiveLayout>
        <Container maxWidth="sm" sx={{ py: 8, textAlign: "center" }}>
          <Typography variant="h4" fontWeight={700} gutterBottom>{t("gameNotFound")}</Typography>
          <Typography color="text.secondary" gutterBottom>{t("gameNotFoundDesc")}</Typography>
          <Button variant="contained" href="/" sx={{ mt: 2 }}>{t("createNewGame")}</Button>
        </Container>
      </ResponsiveLayout>
    </ThemeModeProvider>
  );

  const rule = parseRecurrenceRule(event.recurrenceRule);
  const wasReset = event.wasReset ?? false;
  const isAuthenticated = !!session?.user;
  const isOwner = !!(session?.user && event.ownerId && session.user.id === event.ownerId);
  const isOwnerless = !event.ownerId;
  // Owner-only controls are shown if: no owner (legacy behavior) or current user is owner
  const canEditSettings = isOwnerless || isOwner;
  // User can only claim an anonymous player if they don't already have a linked player in this event
  const userHasLinkedPlayer = isAuthenticated && event.players.some((p: any) => p.userId === session.user.id);
  const canClaimPlayer = isAuthenticated && !userHasLinkedPlayer;

  const handleClaimOwnership = async () => {
    const res = await fetch(`/api/events/${eventId}/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    if (res.ok) {
      mutate();
      setSnackbar(t("claimOwnership"));
    }
  };

  const handleRelinquishOwnership = async () => {
    setRelinquishConfirmOpen(false);
    const res = await fetch(`/api/events/${eventId}/claim`, { method: "DELETE" });
    if (res.ok) {
      mutate();
    }
  };

  // Determine if the current viewer can remove a given player
  const canRemovePlayer = (player: Player) => {
    // Owner can remove anyone
    if (isOwner) return true;
    // Authenticated user can remove themselves
    if (session?.user && player.userId === session.user.id) return true;
    // Anyone can remove anonymous (non-linked) players
    if (!player.userId) return true;
    // Cannot remove other authenticated players
    return false;
  };

  return (
    <ThemeModeProvider>
      <ResponsiveLayout>
        <Container maxWidth="md" sx={{ py: 4 }}>
          <Stack spacing={3}>

            {wasReset && (
              <Alert severity="info" icon={<EventRepeatIcon />}>
                {t("recurringResetAlert", {
                  date: gameDate.toLocaleDateString(locale === "pt" ? "pt-PT" : "en-GB", {
                    weekday: "long", month: "long", day: "numeric",
                  }),
                })}
              </Alert>
            )}

            {/* Header */}
            <Paper elevation={2} sx={{ borderRadius: 3, p: { xs: 2, sm: 3 } }}>
              <Stack spacing={2}>
                <Box>
                  {editingTitle && canEditSettings ? (
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      <TextField
                        size="small"
                        value={titleDraft}
                        onChange={(e) => setTitleDraft(e.target.value)}
                        inputProps={{ maxLength: 100 }}
                        sx={{ flex: 1 }}
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleSaveTitle();
                          if (e.key === "Escape") setEditingTitle(false);
                        }}
                      />
                      <IconButton size="small" onClick={handleSaveTitle} color="primary">
                        <CheckIcon fontSize="small" />
                      </IconButton>
                      <IconButton size="small" onClick={() => setEditingTitle(false)}>
                        <CloseIcon fontSize="small" />
                      </IconButton>
                    </Box>
                  ) : (
                    <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                      <Typography variant="h4" fontWeight={700}>{event.title}</Typography>
                      {canEditSettings && (
                        <IconButton size="small" onClick={() => { setTitleDraft(event.title); setEditingTitle(true); }}>
                          <EditIcon sx={{ fontSize: 18 }} />
                        </IconButton>
                      )}
                    </Box>
                  )}
                  <Stack direction="row" spacing={0.5} sx={{ mt: 0.5, flexWrap: "wrap", alignItems: "center" }}>
                    {rule && (
                      <Chip icon={<EventRepeatIcon />} label={describeRecurrenceRule(rule, locale)}
                        size="small" color="secondary" />
                    )}
                    <Chip
                      icon={<SportsSoccerIcon />}
                      label={t(getSportPreset(sport).labelKey as any)}
                      size="small"
                      color="primary"
                      variant="outlined"
                    />
                    {event.ownerName && (
                      <Typography variant="body2" color="text.secondary" sx={{ ml: 0.5 }}>
                        {t("managedBy", { name: "" })}
                        <a href={`/users/${event.ownerId}`} style={{ textDecoration: "none", color: "inherit", fontWeight: 600 }}>
                          {event.ownerName}
                        </a>
                      </Typography>
                    )}
                  </Stack>
                </Box>

                <Stack direction="row" spacing={2} flexWrap="wrap">
                {editingLocation && canEditSettings ? (
                    <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, flex: 1 }}>
                      <LocationOnIcon fontSize="small" color="action" />
                      <TextField
                        size="small"
                        value={locationDraft}
                        onChange={(e) => setLocationDraft(e.target.value)}
                        placeholder={t("locationPlaceholder")}
                        inputProps={{ maxLength: 200 }}
                        sx={{ flex: 1 }}
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleSaveLocation();
                          if (e.key === "Escape") setEditingLocation(false);
                        }}
                      />
                      <IconButton size="small" onClick={handleSaveLocation} color="primary">
                        <CheckIcon fontSize="small" />
                      </IconButton>
                      <IconButton size="small" onClick={() => setEditingLocation(false)}>
                        <CloseIcon fontSize="small" />
                      </IconButton>
                    </Box>
                  ) : (
                    <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                      <LocationOnIcon fontSize="small" color="action" />
                      {event.location ? (
                        <Typography
                          variant="body2"
                          color="text.secondary"
                          component="a"
                          href={/^https?:\/\//i.test(event.location) ? event.location : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.location)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          sx={{ textDecoration: "none", "&:hover": { textDecoration: "underline", color: "primary.main" } }}
                        >
                          {event.location}
                        </Typography>
                      ) : (
                        <Typography variant="body2" color="text.disabled">
                          {t("locationOptional")}
                        </Typography>
                      )}
                      {canEditSettings && (
                        <Tooltip title={t("editLocation")}>
                          <IconButton size="small" onClick={() => { setLocationDraft(event.location || ""); setEditingLocation(true); }}>
                            <EditIcon sx={{ fontSize: 16 }} />
                          </IconButton>
                        </Tooltip>
                      )}
                    </Box>
                  )}
                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                    <AccessTimeIcon fontSize="small" color="action" />
                    <Typography variant="body2" color="text.secondary">
                      {gameDate.toLocaleString(locale === "pt" ? "pt-PT" : "en-GB", {
                        weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
                      })}
                    </Typography>
                  </Box>
                </Stack>

                <Box sx={{
                  display: "inline-flex", alignItems: "center", gap: 1,
                  px: 2, py: 1, borderRadius: 2, width: "fit-content",
                  backgroundColor: alpha(theme.palette.primary.main, 0.08),
                }}>
                  <AccessTimeIcon color="primary" fontSize="small" />
                  <Typography variant="body1" fontWeight={600} color="primary">{countdown}</Typography>
                </Box>

                <Divider />

                {/* ── Quick Actions — always visible ── */}
                <Stack spacing={1}>
                  <ShareBar title={event.title} />
                  <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", alignItems: "center" }}>
                    {(gameDate <= new Date() || event.isRecurring) && (
                      <Button variant="outlined" size="small" startIcon={<HistoryIcon />}
                        href={`/events/${eventId}/history`} sx={{ flexShrink: 0 }}>
                        {t("history")}
                      </Button>
                    )}
                    <Button variant="outlined" size="small" startIcon={<CalendarMonthIcon />}
                      href={`/api/events/${eventId}/calendar`} sx={{ flexShrink: 0 }}>
                      {t("downloadIcs")}
                    </Button>
                    <Button variant="outlined" size="small" startIcon={<CalendarMonthIcon />}
                      href={googleCalendarUrl({
                        id: eventId,
                        title: event.title,
                        location: event.location,
                        dateTime: new Date(event.dateTime),
                        url: typeof window !== "undefined" ? window.location.href : undefined,
                        recurrence: event.isRecurring && event.recurrenceRule
                          ? JSON.parse(event.recurrenceRule)
                          : undefined,
                      })}
                      target="_blank" rel="noopener noreferrer" sx={{ flexShrink: 0 }}>
                      {t("addToGoogleCalendar")}
                    </Button>
                    <NotifyButton eventId={eventId} />
                    {/* Owner badge — always visible for owners */}
                    {isOwner && (
                      <Chip icon={<StarIcon />} label={t("ownerBadge")} size="small" color="success" variant="outlined" />
                    )}
                    {/* Claim ownership for authenticated users on ownerless events */}
                    {isAuthenticated && isOwnerless && (
                      <Button variant="outlined" size="small" color="secondary" onClick={handleClaimOwnership}>
                        {t("claimOwnership")}
                      </Button>
                    )}
                  </Box>
                </Stack>

                {/* ── Event Settings — collapsed accordion for owner/advanced controls ── */}
                {canEditSettings && (
                  <Accordion
                    disableGutters
                    elevation={0}
                    sx={{
                      "&:before": { display: "none" },
                      backgroundColor: "transparent",
                    }}
                  >
                    <AccordionSummary
                      expandIcon={<ExpandMoreIcon />}
                      sx={{ px: 0, minHeight: 0, "& .MuiAccordionSummary-content": { my: 0.5 } }}
                    >
                      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                        <SettingsIcon fontSize="small" color="action" />
                        <Typography variant="body2" color="text.secondary">
                          {t("eventSettings")}
                        </Typography>
                      </Box>
                    </AccordionSummary>
                    <AccordionDetails sx={{ px: 0, pt: 0 }}>
                      <Stack spacing={2}>
                        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", alignItems: "center" }}>
                          <Tooltip title={t("makePublicTooltip")}>
                            <FormControlLabel
                              control={
                                <Switch size="small" checked={isPublic}
                                  onChange={(e) => handleTogglePublic(e.target.checked)} />
                              }
                              label={
                                <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                                  <PublicIcon fontSize="small" />
                                  <Typography variant="body2">{t("makePublic")}</Typography>
                                </Box>
                              }
                              sx={{ ml: 0 }}
                            />
                          </Tooltip>
                          <FormControl size="small" sx={{ minWidth: 140 }}>
                            <Select
                              value={sport}
                              onChange={(e) => handleSportChange(e.target.value)}
                              sx={{ fontSize: "0.85rem" }}
                            >
                              {SPORT_PRESETS.map((s) => (
                                <MenuItem key={s.id} value={s.id} sx={{ fontSize: "0.85rem" }}>
                                  {t(s.labelKey as any)}
                                </MenuItem>
                              ))}
                            </Select>
                          </FormControl>
                        </Box>
                        {/* Balanced teams toggle */}
                        <Tooltip title={t("balancedTeamsTooltip")}>
                          <FormControlLabel
                            control={<Switch size="small" checked={balanced} onChange={(e) => handleToggleBalanced(e.target.checked)} />}
                            label={t("balancedTeams")}
                          />
                        </Tooltip>
                        {/* Owner controls — relinquish */}
                        {isOwner && (
                          <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", alignItems: "center" }}>
                            <Tooltip title={t("relinquishOwnershipDesc")}>
                              <Button variant="text" size="small" color="warning" onClick={() => setRelinquishConfirmOpen(true)}>
                                {t("relinquishOwnership")}
                              </Button>
                            </Tooltip>
                          </Box>
                        )}
                        {/* Integrations */}
                        <WebhookInfo eventId={eventId} />
                      </Stack>
                    </AccordionDetails>
                  </Accordion>
                )}
              </Stack>
            </Paper>

            {/* Quick join — authenticated users only */}
            {isAuthenticated && session?.user?.name && (
              <QuickJoin userName={session.user.name} players={event.players} maxPlayers={event.maxPlayers} onJoin={addPlayer} onLeave={removePlayer} />
            )}

            {/* Players */}
            <Paper elevation={2} sx={{ borderRadius: 3, p: { xs: 2, sm: 3 } }}>
              <Stack spacing={2}>
                {(() => {
                  const active = event.players.slice(0, event.maxPlayers);
                  const bench = event.players.slice(event.maxPlayers);
                  return (
                    <>
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                        <Typography variant="h6" fontWeight={600}>{t("players")}</Typography>
                        <Chip label={t("activePlayers", { n: active.length, max: event.maxPlayers })} size="small" color="primary" />
                        {bench.length > 0 && (
                          <Chip icon={<AirlineSeatReclineNormalIcon />} label={t("benchPlayers", { n: bench.length })} size="small" color="warning" />
                        )}
                        {isOwner && (
                          <Tooltip title={t("resetPlayerOrder")}>
                            <IconButton size="small" onClick={resetPlayerOrder}><RestartAltIcon fontSize="small" /></IconButton>
                          </Tooltip>
                        )}
                      </Box>

                      {playerError && <Alert severity="error" onClose={() => setPlayerError(null)}>{playerError}</Alert>}
                      
                      <Autocomplete
                        freeSolo
                        options={availableSuggestions.map((s) => s.name)}
                        filterOptions={(options, { inputValue }) =>
                          options.filter((opt) => matchesWithName(opt, inputValue))
                        }
                        value={null}
                        inputValue={playerInput}
                        onInputChange={(_, newInputValue, reason) => {
                          if (reason === "reset") return;
                          setPlayerInput(newInputValue);
                          setPlayerError(null);
                        }}
                        onChange={(_, newValue) => {
                          if (typeof newValue === "string" && newValue.trim()) {
                            addPlayer(newValue);
                            setPlayerInput("");
                          }
                        }}
                        renderInput={(params) => (
                          <TextField
                            {...params}
                            variant="outlined"
                            placeholder={t("addPlayerPlaceholder")}
                            helperText={t("addPlayerHelper")}
                            fullWidth
                            inputProps={{ ...params.inputProps, maxLength: 50 }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && playerInput.trim()) {
                                e.preventDefault();
                                e.stopPropagation();
                                addPlayer(playerInput);
                                setPlayerInput("");
                              }
                            }}
                            onPaste={(e) => {
                              const text = e.clipboardData.getData("Text");
                              const names = text.split("\n").map((n) => n.trim()).filter(Boolean);
                              if (names.length > 1) {
                                e.preventDefault();
                                Promise.all(names.map((n) => addPlayer(n))).then(() => setPlayerInput(""));
                              }
                            }}
                            InputProps={{
                              ...params.InputProps,
                              endAdornment: (
                                <InputAdornment position="end">
                                  <IconButton color="primary" edge="end"
                                    disabled={!playerInput.trim()}
                                    onClick={() => { addPlayer(playerInput); setPlayerInput(""); }}>
                                    <PersonAddIcon />
                                  </IconButton>
                                </InputAdornment>
                              ),
                            }}
                          />
                        )}
                        renderOption={(props, option) => {
                          const { key, ...otherProps } = props as any;
                          return (
                            <li key={key} {...otherProps} style={{ minHeight: 44 }}>
                              {option}
                            </li>
                          );
                        }}
                        noOptionsText={t("noSuggestions")}
                      />

                      {/* Recent players — quick-add chips */}
                      {availableSuggestions.length > 0 && (
                        <Box>
                          <Typography variant="body2" color="text.secondary" sx={{ mb: 0.75 }}>
                            {t("recentPlayers")}:
                          </Typography>
                          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
                            {availableSuggestions.slice(0, 12).map((s) => (
                              <Chip
                                key={s.name}
                                label={s.name}
                                variant="outlined"
                                size="small"
                                onClick={() => { addPlayer(s.name); }}
                                sx={{
                                  cursor: "pointer",
                                  "&:hover": { backgroundColor: alpha(theme.palette.primary.main, 0.1) },
                                }}
                              />
                            ))}
                          </Box>
                        </Box>
                      )}

                      {active.length > 0 && (
                        <Paper variant="outlined" sx={{
                          p: 1, backgroundColor: alpha(theme.palette.primary.main, 0.06),
                        }}>
                          <List dense disablePadding>
                            {active.map((player, i) => (
                              <ListItem
                                key={player.id}
                                draggable={isOwner}
                                onDragStart={() => handlePlayerDragStart(player.id, i)}
                                onDragOver={(e) => handlePlayerDragOver(e, i)}
                                onDrop={() => handlePlayerDrop(event.players)}
                                onDragEnd={handlePlayerDragEnd}
                                sx={{
                                  borderRadius: 2, px: 1, py: 0.5,
                                  cursor: isOwner ? "grab" : "default",
                                  opacity: dragPlayer?.id === player.id ? 0.3 : 1,
                                  borderTop: dragOverIndex === i && dragPlayer ? `2px solid ${theme.palette.primary.main}` : "2px solid transparent",
                                  transition: "opacity 0.15s",
                                  "&:hover": { bgcolor: alpha(theme.palette.primary.main, 0.04) },
                                }}
                                secondaryAction={
                                  canRemovePlayer(player) ? (
                                    <IconButton edge="end" size="small" onClick={() => removePlayer(player.id)}>
                                      <CloseIcon fontSize="small" />
                                    </IconButton>
                                  ) : undefined
                                }
                              >
                                {isOwner && (
                                    <DragIndicatorIcon fontSize="small" sx={{ color: "text.disabled", mr: 0.5, flexShrink: 0 }} />
                                  )}
                                {player.userId ? (
                                  <Tooltip title={t("protectedPlayer")}>
                                    <ShieldIcon fontSize="small" sx={{ color: "primary.main", mr: 0.5, flexShrink: 0 }} />
                                  </Tooltip>
                                ) : canClaimPlayer ? (
                                  <Tooltip title={t("claimPlayerDesc")}>
                                    <SwapHorizIcon fontSize="small" sx={{ cursor: "pointer", mr: 0.5, flexShrink: 0 }} onClick={() => openClaimPlayerDialog(player.id, player.name)} />
                                  </Tooltip>
                                ) : null}
                                <ListItemText
                                  primary={player.userId ? (
                                    <a href={`/users/${player.userId}`} style={{ textDecoration: "none", color: "inherit", fontWeight: 500 }}>
                                      {player.name}
                                    </a>
                                  ) : player.name}
                                  primaryTypographyProps={{ fontWeight: 500, fontSize: "0.9rem" }}
                                />
                              </ListItem>
                            ))}
                          </List>
                        </Paper>
                      )}

                      {bench.length > 0 && (
                        <>
                          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                            <AirlineSeatReclineNormalIcon fontSize="small" color="warning" />
                            <Typography variant="body2" fontWeight={600} color="warning.main">
                              {t("benchPlayers", { n: bench.length })}
                            </Typography>
                          </Box>
                          <Alert severity="info" sx={{ py: 0.5 }}>{t("benchInfo")}</Alert>
                          <Paper variant="outlined" sx={{
                            p: 1,
                            backgroundColor: alpha(theme.palette.warning.main, 0.04),
                            borderColor: alpha(theme.palette.warning.main, 0.3),
                          }}>
                            <List dense disablePadding>
                              {bench.map((player, i) => {
                                const globalIndex = event.maxPlayers + i;
                                return (
                                  <ListItem
                                    key={player.id}
                                    draggable={isOwner}
                                    onDragStart={() => handlePlayerDragStart(player.id, globalIndex)}
                                    onDragOver={(e) => handlePlayerDragOver(e, globalIndex)}
                                    onDrop={() => handlePlayerDrop(event.players)}
                                    onDragEnd={handlePlayerDragEnd}
                                    sx={{
                                      borderRadius: 2, px: 1, py: 0.5,
                                      cursor: isOwner ? "grab" : "default",
                                      opacity: dragPlayer?.id === player.id ? 0.3 : 1,
                                      borderTop: dragOverIndex === globalIndex && dragPlayer ? `2px solid ${theme.palette.warning.main}` : "2px solid transparent",
                                      transition: "opacity 0.15s",
                                      "&:hover": { bgcolor: alpha(theme.palette.warning.main, 0.04) },
                                    }}
                                    secondaryAction={
                                      canRemovePlayer(player) ? (
                                        <IconButton edge="end" size="small" onClick={() => removePlayer(player.id)}>
                                          <CloseIcon fontSize="small" />
                                        </IconButton>
                                      ) : undefined
                                    }
                                  >
                                    {isOwner && (
                                      <DragIndicatorIcon fontSize="small" sx={{ color: "text.disabled", mr: 0.5, flexShrink: 0 }} />
                                    )}
                                    {player.userId ? (
                                      <Tooltip title={t("protectedPlayer")}>
                                        <ShieldIcon fontSize="small" sx={{ color: "warning.main", mr: 0.5, flexShrink: 0 }} />
                                      </Tooltip>
                                    ) : canClaimPlayer ? (
                                      <Tooltip title={t("claimPlayerDesc")}>
                                        <SwapHorizIcon fontSize="small" sx={{ cursor: "pointer", mr: 0.5, flexShrink: 0 }} onClick={() => openClaimPlayerDialog(player.id, player.name)} />
                                      </Tooltip>
                                    ) : null}
                                    <ListItemText
                                      primary={player.userId ? (
                                        <a href={`/users/${player.userId}`} style={{ textDecoration: "none", color: "inherit", fontWeight: 500 }}>
                                          {`${i + 1}. ${player.name}`}
                                        </a>
                                      ) : `${i + 1}. ${player.name}`}
                                      primaryTypographyProps={{ fontWeight: 500, fontSize: "0.9rem" }}
                                    />
                                  </ListItem>
                                );
                              })}
                            </List>
                          </Paper>
                        </>
                      )}

                      <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 2 }}>
                        <Button variant="contained" size="large" startIcon={<ShuffleIcon />}
                          disabled={active.length < 2} sx={{ px: 4, py: 1.5 }}
                          onClick={() => localMatches && localMatches.length > 0 ? setConfirmOpen(true) : doRandomize()}>
                          {t("randomizeTeams")}
                        </Button>
                      </Box>
                    </>
                  );
                })()}
              </Stack>
            </Paper>

            {/* Teams */}
            {localMatches && localMatches.length > 0 && (
              <Paper elevation={2} sx={{ borderRadius: 3, p: { xs: 2, sm: 3 } }}>
                <Stack spacing={3}>
                  <Typography variant="h6" fontWeight={600}>{t("teams")}</Typography>
                  <TeamPicker
                    matches={localMatches.map((m) => ({
                      ...m,
                      team: m.team === event.teamOneName ? teamOneName
                        : m.team === event.teamTwoName ? teamTwoName : m.team,
                    }))}
                    onResultChange={handleTeamChange}
                    ratingsMap={balanced && canEditSettings ? ratingsMap : undefined}
                    onTeamNameSave={canEditSettings ? (teamIdx, newName) => {
                      if (teamIdx === 0) {
                        setTeamOneName(newName);
                        handleTeamNameSave(newName, teamTwoName);
                      } else {
                        setTeamTwoName(newName);
                        handleTeamNameSave(teamOneName, newName);
                      }
                    } : undefined}
                  />
                </Stack>
              </Paper>
            )}

          </Stack>
        </Container>

        <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)}>
          <DialogTitle>{t("rerandomizeTitle")}</DialogTitle>
          <DialogContent>
            <DialogContentText>{t("rerandomizeDesc")}</DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setConfirmOpen(false)}>{t("cancel")}</Button>
            <Button onClick={doRandomize} variant="contained">{t("randomize")}</Button>
          </DialogActions>
        </Dialog>

        {/* Relinquish ownership confirmation */}
        <Dialog open={relinquishConfirmOpen} onClose={() => setRelinquishConfirmOpen(false)}>
          <DialogTitle>{t("relinquishOwnership")}</DialogTitle>
          <DialogContent>
            <DialogContentText>{t("relinquishOwnershipDesc")}</DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setRelinquishConfirmOpen(false)}>{t("cancelEdit")}</Button>
            <Button onClick={handleRelinquishOwnership} color="warning" variant="contained">
              {t("relinquishOwnership")}
            </Button>
          </DialogActions>
        </Dialog>

        {/* Claim player confirmation */}
        <Dialog open={claimPlayerConfirmOpen} onClose={() => setClaimPlayerConfirmOpen(false)}>
          <DialogTitle>{t("claimPlayerTitle")}</DialogTitle>
          <DialogContent>
            <DialogContentText>
              {t("claimPlayerConfirmDesc", { name: playerToClaim?.name || "" })}
            </DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => { setClaimPlayerConfirmOpen(false); setPlayerToClaim(null); }}>{t("cancel")}</Button>
            <Button onClick={handleClaimPlayerConfirm} variant="contained">
              {t("claimPlayer")}
            </Button>
          </DialogActions>
        </Dialog>

        <Snackbar open={!!snackbar} autoHideDuration={3000} onClose={() => setSnackbar(null)}
          message={snackbar} anchorOrigin={{ vertical: "bottom", horizontal: "center" }} />

        <Snackbar
          open={!!undoData}
          autoHideDuration={60000}
          onClose={() => setUndoData(null)}
          message={undoData ? t("undoRemoveDesc", { name: undoData.name }) : ""}
          anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
          action={
            <Button color="inherit" size="small" onClick={handleUndo}>
              {t("undoRemove")}
            </Button>
          }
        />
      </ResponsiveLayout>
    </ThemeModeProvider>
  );
}
