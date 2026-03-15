import React, { useState, useEffect, useRef, useMemo } from "react";
import useSWR from "swr";
import {
  Container, Paper, Typography, TextField, Button, Box, Stack, Chip,
  Alert, IconButton, Tooltip, InputAdornment, Dialog, DialogTitle,
  DialogContent, DialogContentText, DialogActions, Snackbar, alpha, useTheme, Grid2,
  CircularProgress, Divider, Autocomplete, Accordion, AccordionSummary, AccordionDetails,
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
import { ThemeModeProvider } from "./ThemeModeProvider";
import { ResponsiveLayout } from "./ResponsiveLayout";
import { TeamPicker } from "./TeamPicker";
import type { Imatch } from "~/lib/random";
import { describeRecurrenceRule, parseRecurrenceRule } from "~/lib/recurrence";
import { useT } from "~/lib/useT";
import { detectLocale } from "~/lib/i18n";
import { matchesWithName } from "~/lib/stringMatch";
import { getKnownNames, addKnownName, getQjName, setQjName } from "~/lib/knownNames";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Player { id: string; name: string; }
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
  recurrenceRule: string | null;
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
  eventId,
  players,
  maxPlayers,
  onJoin,
  onLeave,
}: {
  eventId: string;
  players: Player[];
  maxPlayers: number;
  onJoin: (name: string) => Promise<void>;
  onLeave: (id: string) => Promise<void>;
}) {
  const t = useT();
  const theme = useTheme();
  const [name, setName] = useState(() => getQjName());
  const [joining, setJoining] = useState(false);
  const [showAll, setShowAll] = useState(false);
  
  const { data: knownPlayers } = useSWR<{ players: KnownPlayer[] }>(
    `/api/events/${eventId}/known-players`,
    (url) => fetch(url).then((r) => r.json()),
    { revalidateOnFocus: false }
  );
  
  const localKnownNames = useMemo(() => getKnownNames(), []);
  
  const mergedSuggestions = useMemo(() => {
    const serverNames = new Map<string, number>();
    for (const p of knownPlayers?.players ?? []) {
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
  }, [knownPlayers, localKnownNames]);
  
  const currentPlayerNames = useMemo(
    () => new Set(players.map((p) => p.name.toLowerCase())),
    [players]
  );
  
  const availableSuggestions = useMemo(
    () => mergedSuggestions.filter((s) => !currentPlayerNames.has(s.name.toLowerCase())),
    [mergedSuggestions, currentPlayerNames]
  );
  
  const visibleSuggestions = showAll
    ? availableSuggestions
    : availableSuggestions.slice(0, 8);
  
  const joined = players.find((p) => p.name.toLowerCase() === name.trim().toLowerCase());
  const isOnBench = joined ? players.indexOf(joined) >= maxPlayers : false;
  
  const handleJoin = async (joinName?: string) => {
    const trimmed = (joinName ?? name).trim();
    if (!trimmed) return;
    setJoining(true);
    await onJoin(trimmed);
    setQjName(trimmed);
    addKnownName(trimmed);
    setName("");
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
          <>
            {availableSuggestions.length > 0 && (
              <Box>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  {t("recentPlayers")}:
                </Typography>
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, alignItems: "center" }}>
                  {visibleSuggestions.map((s) => {
                    const isQjName = getQjName().trim().toLowerCase() === s.name.toLowerCase();
                    return (
                      <Chip
                        key={s.name}
                        label={s.name}
                        variant={isQjName ? "filled" : "outlined"}
                        color={isQjName ? "primary" : "default"}
                        onClick={() => handleJoin(s.name)}
                        disabled={joining}
                        sx={{
                          cursor: "pointer",
                          minHeight: 44,
                          "&:hover": { backgroundColor: alpha(theme.palette.primary.main, 0.1) },
                        }}
                      />
                    );
                  })}
                  {availableSuggestions.length > 8 && !showAll && (
                    <Button
                      size="small"
                      variant="text"
                      onClick={() => setShowAll(true)}
                      sx={{ textTransform: "none" }}
                    >
                      {t("showAllPlayers")}
                    </Button>
                  )}
                </Box>
              </Box>
            )}
            
            <Box sx={{ display: "flex", gap: 1, position: "relative" }}>
              <Autocomplete
                freeSolo
                options={availableSuggestions.map((s) => s.name)}
                filterOptions={(options, { inputValue }) =>
                  options.filter((opt) => matchesWithName(opt, inputValue))
                }
                value={null}
                inputValue={name}
                onInputChange={(_, newInputValue, reason) => {
                  if (reason === "reset") return;
                  setName(newInputValue);
                }}
                onChange={(_, newValue) => {
                  if (typeof newValue === "string" && newValue.trim()) {
                    handleJoin(newValue);
                  }
                }}
                disabled={joining}
                sx={{ flexGrow: 1 }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    size="small"
                    placeholder={t("quickJoinPlaceholder")}
                    inputProps={{ ...params.inputProps, maxLength: 50 }}
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
              <Button
                variant="contained"
                onClick={() => handleJoin()}
                disabled={!name.trim() || joining}
                sx={{ flexShrink: 0 }}
              >
                {t("quickJoinBtn")}
              </Button>
            </Box>
          </>
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
    { refreshInterval: 5000, revalidateOnFocus: true },
  );
  
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
  }, [event]);

  const addPlayer = async (name: string) => {
    if (!name.trim()) return;
    setPlayerError(null);
    const res = await fetch(`/api/events/${eventId}/players`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Client-Id": clientId.current },
      body: JSON.stringify({ name: name.trim().slice(0, 50) }),
    });
    const json = await res.json();
    if (!res.ok) { setPlayerError(json.error); return; }
    addKnownName(name.trim());
    mutate();
  };

  const removePlayer = async (playerId: string) => {
    await fetch(`/api/events/${eventId}/players`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json", "X-Client-Id": clientId.current },
      body: JSON.stringify({ playerId }),
    });
    mutate();
  };

  const doRandomize = async () => {
    setConfirmOpen(false);
    const res = await fetch(`/api/events/${eventId}/randomize`, { method: "POST" });
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

  const teamsOutOfSync = localMatches &&
    event.players.some((p) => !localMatches.flatMap((m) => m.players).find((mp) => mp.name === p.name));

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
                  <Typography variant="h4" fontWeight={700}>{event.title}</Typography>
                  {rule && (
                    <Chip icon={<EventRepeatIcon />} label={describeRecurrenceRule(rule, locale)}
                      size="small" color="secondary" sx={{ mt: 0.5 }} />
                  )}
                </Box>

                <Stack direction="row" spacing={2} flexWrap="wrap">
                {event.location && (
                    <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                      <LocationOnIcon fontSize="small" color="action" />
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
                <Stack spacing={1}>
                  <ShareBar title={event.title} />
                  <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                    {event.isRecurring && (
                      <Button variant="outlined" size="small" startIcon={<HistoryIcon />}
                        href={`/events/${eventId}/history`} sx={{ flexShrink: 0 }}>
                        {t("history")}
                      </Button>
                    )}
                    <NotifyButton eventId={eventId} />
                  </Box>
                </Stack>

                {/* Integrations — hidden by default, for developers */}
                <WebhookInfo eventId={eventId} />
              </Stack>
            </Paper>

            {/* Quick join */}
            <QuickJoin eventId={eventId} players={event.players} maxPlayers={event.maxPlayers} onJoin={addPlayer} onLeave={removePlayer} />

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

                      {active.length > 0 && (
                        <Paper variant="outlined" sx={{
                          p: 2, display: "flex", flexWrap: "wrap", gap: 1,
                          backgroundColor: alpha(theme.palette.background.default, 0.5),
                        }}>
                          {active.map((player) => (
                            <Chip key={player.id} label={player.name} color="primary" variant="filled"
                              onDelete={() => removePlayer(player.id)} />
                          ))}
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
                            p: 2, display: "flex", flexWrap: "wrap", gap: 1,
                            backgroundColor: alpha(theme.palette.warning.main, 0.04),
                            borderColor: alpha(theme.palette.warning.main, 0.3),
                          }}>
                            {bench.map((player, i) => (
                              <Chip key={player.id} label={`${i + 1}. ${player.name}`} color="warning" variant="outlined"
                                onDelete={() => removePlayer(player.id)} />
                            ))}
                          </Paper>
                        </>
                      )}

                      {teamsOutOfSync && (
                        <Alert severity="warning">{t("teamsOutOfSync")}</Alert>
                      )}

                      <Box sx={{ display: "flex", justifyContent: "center" }}>
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
                  <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 2 }}>
                    <Typography variant="h6" fontWeight={600}>{t("teams")}</Typography>
                    <Stack direction="row" spacing={2} alignItems="center">
                      <InlineEdit value={teamOneName} label="Team 1"
                        onSave={(v) => { setTeamOneName(v); handleTeamNameSave(v, teamTwoName); }} />
                      <Typography variant="h5" color="text.disabled">{t("vs")}</Typography>
                      <InlineEdit value={teamTwoName} label="Team 2"
                        onSave={(v) => { setTeamTwoName(v); handleTeamNameSave(teamOneName, v); }} />
                    </Stack>
                  </Box>
                  <TeamPicker
                    matches={localMatches.map((m) => ({
                      ...m,
                      team: m.team === event.teamOneName ? teamOneName
                        : m.team === event.teamTwoName ? teamTwoName : m.team,
                    }))}
                    onResultChange={handleTeamChange}
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

        <Snackbar open={!!snackbar} autoHideDuration={3000} onClose={() => setSnackbar(null)}
          message={snackbar} anchorOrigin={{ vertical: "bottom", horizontal: "center" }} />
      </ResponsiveLayout>
    </ThemeModeProvider>
  );
}
