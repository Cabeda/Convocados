import React, { useState, useCallback, useRef, useEffect } from "react";
import {
  Paper, Typography, Box, Stack, Chip, Button, Alert,
  IconButton, Tooltip, InputAdornment, TextField, Autocomplete,
  List, ListItem, ListItemText, Collapse,
  alpha, useTheme, LinearProgress, useMediaQuery, CircularProgress,
} from "@mui/material";
import PersonAddIcon from "@mui/icons-material/PersonAdd";
import PersonRemoveIcon from "@mui/icons-material/PersonRemove";
import ShuffleIcon from "@mui/icons-material/Shuffle";
import CloseIcon from "@mui/icons-material/Close";
import AirlineSeatReclineNormalIcon from "@mui/icons-material/AirlineSeatReclineNormal";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import ContactsIcon from "@mui/icons-material/Contacts";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import DoNotDisturbAltIcon from "@mui/icons-material/DoNotDisturbAlt";
import ScheduleSendIcon from "@mui/icons-material/ScheduleSend";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import SendIcon from "@mui/icons-material/Send";
import EmailOutlinedIcon from "@mui/icons-material/EmailOutlined";
import NotificationsActiveIcon from "@mui/icons-material/NotificationsActive";
import AndroidIcon from "@mui/icons-material/Android";
import LinkIcon from "@mui/icons-material/Link";
import { useT } from "~/lib/useT";
import { matchesWithName } from "~/lib/stringMatch";
import { PlayerAvatar, AnonymousPlayerIcon } from "./PlayerIdentity";
import { playerInputPasswordManagerProps } from "./PlayerAutocomplete";
import type { Player, PlayerOption } from "./types";
import type { AddPlayerIntent } from "./AddPlayerConfirmDialog";
import { ConfirmLeaveDialog, type LeaveContext } from "./ConfirmLeaveDialog";
import type { RsvpStatus } from "~/lib/rsvp";

export type { RsvpStatus } from "~/lib/rsvp";

/** Pure helpers — extracted out of the component body so Date.now() inside doesn't trip the
 *  eslint react-hooks/purity rule. They run in event handlers, never during render. */
function computeBenchEmptyAfter(
  playerId: string,
  players: Player[],
  active: Player[],
  maxPlayers: number,
): boolean {
  const wasActive = active.some((p) => p.id === playerId);
  if (!wasActive) return false; // bench player leaving — not "no replacement" for the active roster
  // Bench is currently empty iff total players fit within maxPlayers. If there are already
  // bench players, the leave flow promotes the first one to active, so the slot IS filled.
  return players.length <= maxPlayers;
}

function computeWithin48h(eventDateTime: string | undefined): boolean {
  if (!eventDateTime) return false;
  const kickoff = new Date(eventDateTime).getTime();
  const hoursUntil = (kickoff - Date.now()) / (60 * 60 * 1000);
  return hoursUntil > 0 && hoursUntil <= 48;
}

function isEmailLike(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/** ADR 0025 follow-up: minimum time between invite deliveries (mirrors server RESEND_COOLDOWN_MS). */
export const RESEND_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/** Pure: whether a pending invite can be resent, and how much cooldown remains. */
export function resendEligibility(
  notifiedAt: string | null | undefined,
  nowMs: number,
): { eligible: boolean; remainingMs: number } {
  if (!notifiedAt) return { eligible: true, remainingMs: 0 };
  const elapsed = nowMs - new Date(notifiedAt).getTime();
  const remainingMs = Math.max(0, RESEND_COOLDOWN_MS - elapsed);
  return { eligible: remainingMs <= 0, remainingMs };
}

/** Pure: humanize remaining cooldown ("23h 5m" / "42m"). */
export function formatCooldown(remainingMs: number): string {
  const totalMin = Math.ceil(remainingMs / 60_000);
  if (totalMin >= 60) {
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  return `${totalMin}m`;
}

/** Ticking now() for render-time cooldown math (keeps Date.now() out of render). */
function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export interface InviteChannelFlags {
  email: boolean;
  webPush: boolean;
  appPush: boolean;
}

/** Icon per delivery channel key (see sentChannels). */
const CHANNEL_ICONS: Record<string, typeof EmailOutlinedIcon> = {
  email: EmailOutlinedIcon,
  web: NotificationsActiveIcon,
  app: AndroidIcon,
};

/** Pure: which channels a pending invite was sent through. */
export function sentChannels(channels: InviteChannelFlags | undefined): Array<{ key: string; labelKey: InviteChannelLabelKey }> {
  if (!channels) return [];
  const out: Array<{ key: string; labelKey: InviteChannelLabelKey }> = [];
  if (channels.email) out.push({ key: "email", labelKey: "channelEmail" });
  if (channels.webPush) out.push({ key: "web", labelKey: "channelWebPush" });
  if (channels.appPush) out.push({ key: "app", labelKey: "channelAppPush" });
  return out;
}

/**
 * Delivery-channel chip. Progressive: icon-only on narrow screens (<sm) with an
 * aria-label for screen readers; icon + text from sm up. Keeps invited rows on
 * a single line on phones.
 */
type InviteChannelLabelKey = "channelEmail" | "channelWebPush" | "channelAppPush";

function ChannelChip({ channelKey, labelKey, compact, inviteId }: { channelKey: string; labelKey: InviteChannelLabelKey; compact: boolean; inviteId: string }) {
  const t = useT();
  const Icon = CHANNEL_ICONS[channelKey] ?? NotificationsActiveIcon;
  return (
    <Chip
      size="small"
      variant="outlined"
      color="default"
      icon={<Icon fontSize="small" />}
      label={compact ? undefined : t(labelKey)}
      aria-label={t(labelKey)}
      data-testid={`invite-channel-${channelKey}-${inviteId}`}
    />
  );
}

interface PlayerSuggestion {
  name: string;
  gamesPlayed: number;
  userId?: string | null;
  image?: string | null;
  /** Times the viewer has co-played with this person on OTHER events (global). */
  coPlayCount?: number;
}

interface Props {
  players: Player[];
  maxPlayers: number;
  isOwner: boolean;
  hasTeams: boolean;
  availableSuggestions: PlayerSuggestion[];
  playerError: string | null;
  onPlayerErrorChange: (error: string | null) => void;
  onAddPlayer: (name: string, email?: string) => Promise<void>;
  /** Trigger the confirmation dialog. Used by single-tap paths (chip, dropdown). */
  onRequestAdd?: (intent: AddPlayerIntent) => void;
  onRemovePlayer: (playerId: string) => Promise<void>;
  onReorderPlayers: (playerIds: string[]) => Promise<void>;
  onResetPlayerOrder: () => Promise<void>;
  onRandomize: () => void;
  onConfirmReRandomize: () => void;
  /** True while the server is applying a team randomization. */
  isRandomizing?: boolean;
  canRemovePlayer: (player: Player) => boolean;
  // #XXX Attendance UI (simplified — Quick Join / Quick Leave / You row are gone; replaced by AttendanceCta)
  /** Current authenticated user's id, if any. When set, the AttendanceCta is rendered above the list. */
  currentUserId?: string | null;
  /** Current user's RSVP status, fetched separately. */
  myRsvpStatus?: RsvpStatus;
  /** @deprecated pill removed — kept for test shim */
  guestRsvpMap?: Record<string, RsvpStatus>;
  /** @deprecated pill removed — kept for test shim */
  userRsvpMap?: Record<string, RsvpStatus>;
  /** @deprecated pill removed */
  canEditGuestAttendance?: boolean;
  /** @deprecated pill removed */
  onSetGuestRsvp?: (playerId: string, status: RsvpStatus) => Promise<void>;
  /** Hide all add-player surfaces (input, submit, recent chips). Used when the
   *  game has ended and the roster is frozen — roster fixes go via game history. */
  rosterLocked?: boolean;
  /** Set the current user's own RSVP. */
  onSetMyRsvp?: (status: "yes" | "no") => Promise<void>;
  /** Called by AttendanceCta's "Going" button when the user is NOT on the list. The parent
   *  typically routes this through the payment-nudge dialog before adding the user. */
  onJoinAsSelf?: () => void;
  // #XXX Leave flow
  /** ISO dateTime of the event. Used to determine if we're within 48h before kickoff for the leave-warning copy. */
  eventDateTime?: string;
  /** ADR 0025: players who declined (rsvp=no) the current game. Server-gated —
   *  only participants/owner/admins receive a non-empty array. Read-only display. */
  declined?: Array<{ id: string; name: string; userId: string | null; image?: string | null }>;
  /** ADR 0025: pending PlayerInvite entries for the current game. Server-gated.
   *  Read-only display — these are roster ghosts, not members yet. Each entry
   *  may carry the persisted delivery channels + notifiedAt (ADR 0025 follow-up). */
  invited?: Array<{
    id: string;
    inviteId?: string | null;
    name: string;
    userId: string | null;
    image?: string | null;
    channels?: { email: boolean; webPush: boolean; appPush: boolean };
    notifiedAt?: string | null;
  }>;
  /** Owner/admin flag: shows the per-invite resend action when onResendInvite is set. */
  canManageInvites?: boolean;
  /** ADR 0025 follow-up: resend a pending invite (server enforces a 24h cooldown). */
  onResendInvite?: (invite: { id: string; inviteId?: string | null; name: string }) => Promise<void>;
  /** Id of an invite currently being resent — disables that row's button. */
  resendingInviteId?: string | null;
  /** ADR 0025 follow-up: retract (remove) a pending invite so it no longer applies. */
  onRetractInvite?: (invite: { id: string; inviteId?: string | null; name: string }) => Promise<void>;
  /** Id of an invite currently being retracted — disables that row's button. */
  retractingInviteId?: string | null;
  /** ADR 0025: ranked co-play suggestions (owner/admin). Clicking one requests the
   *  add-or-invite choice (onRequestAdd) instead of inviting directly. */
  coPlaySuggestions?: Array<{ userId: string | null; name: string; image?: string | null; reason?: string }>;
  /** @deprecated chip now requests choice via onRequestAdd */
  onInviteUser?: (userId: string, name: string) => Promise<void>;
}

export function PlayerList({
  players, maxPlayers, isOwner, hasTeams,
  availableSuggestions, playerError, onPlayerErrorChange,
  onAddPlayer, onRequestAdd, onRemovePlayer, onReorderPlayers, onResetPlayerOrder,
  onRandomize, onConfirmReRandomize, isRandomizing = false, canRemovePlayer,
  currentUserId: _currentUserId,
  myRsvpStatus: _myRsvpStatus,
  guestRsvpMap: _guestRsvpMap,
  userRsvpMap: _userRsvpMap,
  canEditGuestAttendance: _canEditGuestAttendance,
  onSetGuestRsvp: _onSetGuestRsvp,
  onSetMyRsvp,
  onJoinAsSelf: _onJoinAsSelf,
  eventDateTime,
  rosterLocked = false,
  declined,
  invited,
  canManageInvites = false,
  onResendInvite,
  resendingInviteId = null,
  onRetractInvite,
  retractingInviteId = null,
  coPlaySuggestions,
  onInviteUser: _onInviteUser,
}: Props) {
  const t = useT();
  const theme = useTheme();
  const [playerInput, setPlayerInput] = useState("");
  const [showAllPills, setShowAllPills] = useState(false);
  const [declinedOpen, setDeclinedOpen] = useState(false);
  // Ticking clock for invite resend cooldowns (ADR 0025 follow-up).
  const now = useNow();
  // Progressive disclosure: icon-only channel chips + compact controls below sm.
  const isWide = useMediaQuery(theme.breakpoints.up("sm"));

  // Detect if the current input looks like an email address
  const isEmailInput = isEmailLike(playerInput.trim());

  // Feature-detect the Contact Picker API. Available in Chromium-based browsers
  // (Chrome, Edge, Opera, Samsung Internet). Hidden on Safari / Firefox — see ADR-0010.
  const contactPickerSupported =
    typeof navigator !== "undefined" &&
    "contacts" in navigator &&
    typeof (navigator as unknown as { contacts?: { select?: unknown } }).contacts?.select === "function";

  const handlePickContact = useCallback(async () => {
    if (!contactPickerSupported) return;
    try {
      const nav = navigator as unknown as {
        contacts: {
          select: (
            fields: ("name" | "email" | "tel")[],
            options?: { multiple?: boolean },
          ) => Promise<Array<{ name?: string[]; email?: string[] }>>;
        };
      };
      const contacts = await nav.contacts.select(["name", "email"], { multiple: false });
      const picked = contacts[0];
      if (!picked) return;
      const name = (picked.name?.[0] ?? "").trim();
      const email = (picked.email?.[0] ?? "").trim();
      if (email) {
        // Android parity: auto-add when we have both name and email.
        await onAddPlayer(name, email);
        setPlayerInput("");
      } else if (name) {
        // No email — prefill name only, let the user type an email to invite.
        setPlayerInput(name);
      }
    } catch {
      // User cancelled, or browser blocked the picker. Silent — falls through to the typed flow.
    }
  }, [contactPickerSupported, onAddPlayer]);

  // ── Player reorder drag state ──────────────────────────────────────────────
  const [dragPlayer, setDragPlayer] = useState<{ id: string; index: number } | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const handlePlayerDragStart = useCallback((playerId: string, index: number) => {
    setDragPlayer({ id: playerId, index });
  }, []);

  const handlePlayerDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    setDragOverIndex(index);
  }, []);

  const handlePlayerDrop = useCallback(() => {
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
    onReorderPlayers(ids);
  }, [dragPlayer, dragOverIndex, players, onReorderPlayers]);

  const handlePlayerDragEnd = useCallback(() => {
    setDragPlayer(null);
    setDragOverIndex(null);
  }, []);

  const active = players.slice(0, maxPlayers);
  const bench = players.slice(maxPlayers);

  // #XXX Attendance — guest pill opens a small menu (set Going / Declined / No response / Clear).
  // The previous cycle (Pending → Yes → No → Pending) was error-prone; the menu makes the action
  // explicit and supports clearing back to null.

  // #XXX Leave flow — confirm dialog state. All four "remove from list" paths converge here.
  const [leaveDialog, setLeaveDialog] = useState<{
    open: boolean;
    context: LeaveContext;
    playerId: string | null;
    playerName: string;
    benchEmptyAfter: boolean;
    within48h: boolean;
    busy: boolean;
  }>({
    open: false, context: "self", playerId: null, playerName: "",
    benchEmptyAfter: false, within48h: false, busy: false,
  });

  // Snapshot the data the openLeaveDialog handler needs into a ref so the function
  // doesn't have to be re-created (or re-evaluated) on every render — that keeps
  // Date.now() out of the render body (eslint react-hooks/purity) and the React Compiler happy.
  const leaveSnapshotRef = useRef({ players, active, maxPlayers, eventDateTime });
  leaveSnapshotRef.current = { players, active, maxPlayers, eventDateTime };

  /** Opens the confirm dialog. Pure: all data passed in as arguments, only Date.now() (allowed in event handlers). */
  function openLeaveDialog(playerId: string, context: LeaveContext) {
    const snapshot = leaveSnapshotRef.current;
    const benchEmptyAfter = computeBenchEmptyAfter(
      playerId, snapshot.players, snapshot.active, snapshot.maxPlayers,
    );
    const within48h = computeWithin48h(snapshot.eventDateTime);
    const playerName = snapshot.players.find((pl) => pl.id === playerId)?.name ?? "";
    setLeaveDialog({
      open: true,
      context,
      playerId,
      playerName,
      benchEmptyAfter,
      within48h,
      busy: false,
    });
  }

  const closeLeaveDialog = useCallback(() => {
    setLeaveDialog((d) => ({ ...d, open: false }));
  }, []);

  const confirmLeave = useCallback(async () => {
    const { context, playerId } = leaveDialog;
    if (!playerId) return;
    setLeaveDialog((d) => ({ ...d, busy: true }));
    try {
      if (context === "self") {
        // "No" on the You row → decline + leave. The backend sets Rsvp=no + archives the player.
        await onSetMyRsvp?.("no");
      } else {
        // Organizer X (any row) OR admin declining a guest pill cycling to "no".
        // The DELETE endpoint (onRemovePlayer) handles all cases: it soft-archives, writes
        // Rsvp=no for the linked-user and guest-decline cases, and tolerates unauthenticated
        // requests (the lib skips the Rsvp audit row when there's no actor userId).
        // The guest RSVP endpoint (onSetGuestRsvp) is reserved for the inline status changes
        // from the guest pill menu (Going / Clear / No response — not Declined).
        await onRemovePlayer(playerId);
        return;
      }
    } finally {
      setLeaveDialog((d) => ({ ...d, open: false, busy: false }));
    }
  }, [leaveDialog, onSetMyRsvp, onRemovePlayer, players]);

  return (
    <Paper elevation={2} sx={{ borderRadius: 3, p: { xs: 2, sm: 3 } }}>
      <Stack spacing={2}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Typography variant="h6" fontWeight={600}>{t("players")}</Typography>
          <Chip label={t("activePlayers", { n: active.length, max: maxPlayers })} size="small" color="primary" />
          {bench.length > 0 && (
            <Chip icon={<AirlineSeatReclineNormalIcon />} label={t("benchPlayers", { n: bench.length })} size="small" color="warning" />
          )}
          {isOwner && (
            <Tooltip title={t("resetPlayerOrder")}>
              <IconButton size="small" onClick={onResetPlayerOrder}><RestartAltIcon fontSize="small" /></IconButton>
            </Tooltip>
          )}
        </Box>

        {/* Player progress bar + social momentum nudge */}
        {maxPlayers > 0 && (() => {
          const fillPct = active.length / maxPlayers;
          const spotsLeft = maxPlayers - active.length;
          const isFull = spotsLeft <= 0;
          // ponytail: momentum messages at different fill levels.
          // Ceiling: static thresholds. Upgrade path: A/B test copy.
          const nudge = isFull ? t("momentumFull")
            : fillPct >= 0.8 ? t("momentumFillingFast", { n: String(spotsLeft) })
            : fillPct >= 0.5 ? t("momentumAlmostHalf", { n: String(spotsLeft) })
            : null;
          return (
            <Box>
              <LinearProgress
                variant="determinate"
                value={Math.min(fillPct * 100, 100)}
                color={isFull ? "error" : fillPct >= 0.75 ? "warning" : "primary"}
                sx={{ borderRadius: 1, height: 6 }}
              />
              {nudge && (
                <Typography variant="caption" fontWeight={600} sx={{ mt: 0.5, display: "block", color: isFull ? "error.main" : fillPct >= 0.8 ? "warning.main" : "text.secondary" }}>
                  {nudge}
                </Typography>
              )}
            </Box>
          );
        })()}

        {playerError && <Alert severity="error" onClose={() => onPlayerErrorChange(null)}>{playerError}</Alert>}

        {!rosterLocked && (<>
        <Stack direction="row" spacing={1} alignItems="stretch">
          <Autocomplete<PlayerOption, false, false, true>
            sx={{ flex: 1, minWidth: 0 }}
            freeSolo
            options={(() => {
              const trimmed = playerInput.trim();
              // If it looks like an email, show an "invite by email" option instead of player suggestions
              if (isEmailInput) {
                return [{ type: "create" as const, name: trimmed }];
              }
              const filtered: PlayerOption[] = availableSuggestions
                .filter((s) => matchesWithName(s.name, trimmed))
                .map((s) => ({
                  type: "existing" as const,
                  name: s.name,
                  gamesPlayed: s.gamesPlayed,
                  userId: s.userId ?? null,
                  image: s.image ?? null,
                  coPlayCount: s.coPlayCount ?? 0,
                }));
              // Add "Create new player" option when input doesn't exactly match an existing suggestion
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
              typeof option !== "string" && typeof value !== "string" && option.type === value.type && option.name === value.name
            }
            value={null}
            inputValue={playerInput}
            onInputChange={(_, newInputValue, reason) => {
              if (reason === "reset") return;
              setPlayerInput(newInputValue);
              onPlayerErrorChange(null);
            }}
            onChange={(_, newValue) => {
              if (!newValue) return;
              const val = typeof newValue === "string" ? newValue.trim() : newValue.name;
              if (!val) return;
              const email = isEmailLike(val) ? val : undefined;
              const userId = typeof newValue !== "string" && newValue.type === "existing"
                ? (newValue.userId ?? undefined)
                : undefined;
              if (onRequestAdd) {
                // Every add path asks invite-vs-add — the dialog dispatches the actual call.
                onRequestAdd({ kind: "single", name: val, email, userId, source: "dropdown" });
              } else {
                onAddPlayer(email ? val.split("@")[0] : val, email);
              }
              setPlayerInput("");
            }}
            renderInput={(params) => (
              <TextField
                {...params}
                variant="outlined"
                size="small"
                placeholder={t("addPlayerPlaceholder")}
                fullWidth
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const trimmed = playerInput.trim();
                    if (!trimmed) return;
                    // If a suggestion matches, let the user pick it from the dropdown
                    // instead of creating a duplicate — the dropdown carries the userId.
                    const hasExactMatch = availableSuggestions.some(
                      (s) => s.name.toLowerCase() === trimmed.toLowerCase()
                    );
                    if (hasExactMatch) return;
                    const hasPartialMatch = availableSuggestions.some(
                      (s) => matchesWithName(s.name, trimmed)
                    );
                    if (hasPartialMatch) return;
                    e.preventDefault();
                    e.stopPropagation();
                    if (onRequestAdd) {
                      onRequestAdd({
                        kind: "single",
                        name: trimmed,
                        email: isEmailLike(trimmed) ? trimmed : undefined,
                        source: "input",
                      });
                    } else {
                      onAddPlayer(trimmed);
                    }
                    setPlayerInput("");
                  }
                }}
                onPaste={(e) => {
                  const text = e.clipboardData.getData("Text");
                  const names = text.split("\n").map((n) => n.trim()).filter(Boolean);
                  if (names.length > 1) {
                    e.preventDefault();
                    Promise.all(names.map((n) => onAddPlayer(n))).then(() => setPlayerInput(""));
                  }
                }}
                slotProps={{
                  input: {
                    ...params.slotProps.input,
                    startAdornment: contactPickerSupported ? (
                      <InputAdornment position="start">
                        <Tooltip title={t("addFromContacts")}>
                          <IconButton
                            size="small"
                            color="primary"
                            edge="start"
                            data-testid="pick-contact"
                            aria-label={t("addFromContacts")}
                            onClick={handlePickContact}
                          >
                            <ContactsIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </InputAdornment>
                    ) : undefined,
                  },

                  htmlInput: { ...params.slotProps.htmlInput, maxLength: 120, ...playerInputPasswordManagerProps }
                }} />
            )}
            renderOption={(props, option) => {
              const { key, ...otherProps } = props as React.HTMLAttributes<HTMLLIElement> & { key?: React.Key };
              if (option.type === "create") {
                const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(option.name);
                return (
                  <li key={key} {...otherProps} style={{ minHeight: 44, fontStyle: "italic", display: "flex", alignItems: "center", gap: 8 }}>
                    <PersonAddIcon fontSize="small" color="primary" />
                    {isEmail ? t("inviteByEmailOption", { email: option.name }) : t("createNewPlayer", { name: option.name })}
                  </li>
                );
              }
              return (
                <li key={key} {...otherProps} style={{ minHeight: 44, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, width: "100%" }}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, minWidth: 0, overflow: "hidden" }}>
                    {option.userId ? (
                      <Tooltip title={t("protectedPlayer")}>
                        <span><PlayerAvatar userId={option.userId} name={option.name} image={option.image} size={20} clickable={false} /></span>
                      </Tooltip>
                    ) : (
                      <Tooltip title={t("anonymousPlayer")}>
                        <span><AnonymousPlayerIcon /></span>
                      </Tooltip>
                    )}
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{option.name}</span>
                  </Box>
                  {(() => {
                    // Transparent source: per-event history vs global co-play.
                    if (option.gamesPlayed > 0) {
                      return (
                        <Typography variant="caption" color="text.secondary" sx={{ ml: 1, flexShrink: 0 }}>
                          {t("nGamesHere", { n: option.gamesPlayed })}
                        </Typography>
                      );
                    }
                    if ((option.coPlayCount ?? 0) > 0) {
                      return (
                        <Typography variant="caption" color="text.secondary" sx={{ ml: 1, flexShrink: 0 }}>
                          {t("coPlayedWithYou", { n: option.coPlayCount ?? 0 })}
                        </Typography>
                      );
                    }
                    return null;
                  })()}
                </li>
              );
            }}
            noOptionsText={t("noSuggestions")}
          />

          <IconButton
            color="primary"
            data-testid="add-player-submit"
            aria-label={t("addPlayerSubmit")}
            disabled={!playerInput.trim()}
            onClick={() => {
              const trimmed = playerInput.trim();
              if (!trimmed) return;
              if (onRequestAdd) {
                onRequestAdd({
                  kind: "single",
                  name: trimmed,
                  email: isEmailLike(trimmed) ? trimmed : undefined,
                  source: "input",
                });
              } else {
                onAddPlayer(trimmed);
              }
              setPlayerInput("");
            }}
            sx={{ alignSelf: "stretch", borderRadius: 1, border: 1, borderColor: "divider", px: 1.5 }}
          >
            <PersonAddIcon />
          </IconButton>
        </Stack>

        {contactPickerSupported && (
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", fontStyle: "italic" }}>
            {t("addFromContactsHint")}
          </Typography>
        )}

        {/* ADR 0025 + dex f79w7x29: co-play suggestions (owner/admin) with
            fallback pills merged in by EventPage. Ranked inviteables first,
            known players / co-players fill the rest while roster has room.
            Each chip opens the add-or-invite choice (dialog). */}
        {coPlaySuggestions && coPlaySuggestions.length > 0 && !playerInput.trim() && (
          <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 0.75 }}>
              {t("coPlaySuggestions")}:
            </Typography>
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, alignItems: "center" }}>
              {(showAllPills ? coPlaySuggestions : coPlaySuggestions.slice(0, 8)).map((s) => {
                // Linked pills match roster/invited by userId; anonymous pills
                // must never collide on the shared null userId (name instead).
                const matchesPill = (row: { userId?: string | null; name?: string }) =>
                  s.userId ? row.userId === s.userId : row.name?.toLowerCase() === s.name.toLowerCase();
                const alreadyIn = players.some(matchesPill)
                  || (invited ?? []).some((i) => matchesPill(i));
                if (alreadyIn) return null;
                const chipId = s.userId ?? `name:${s.name}`;
                return (
                  <Chip
                    key={chipId}
                    data-testid={`suggest-chip-${chipId}`}
                    icon={s.image
                      ? <PlayerAvatar userId={s.userId} name={s.name} image={s.image} size={18} clickable={false} />
                      : <PersonAddIcon fontSize="small" />}
                    label={s.name}
                    variant="outlined"
                    size="small"
                    color="primary"
                    title={s.reason}
                    onClick={() => {
                      if (onRequestAdd) {
                        onRequestAdd({ kind: "single", name: s.name, userId: s.userId ?? undefined, source: "chip" });
                      } else {
                        onAddPlayer(s.name);
                      }
                    }}
                    sx={{ cursor: "pointer", "&:hover": { backgroundColor: alpha(theme.palette.primary.main, 0.12) } }}
                  />
                );
              })}
              {coPlaySuggestions.length > 8 && (
                <Chip
                  size="small"
                  variant="outlined"
                  clickable
                  data-testid="suggest-pills-toggle"
                  label={showAllPills ? t("showFewerSuggestions") : t("showMoreSuggestions")}
                  onClick={() => setShowAllPills((v) => !v)}
                  sx={{ cursor: "pointer" }}
                />
              )}
            </Box>
          </Box>
        )}
        </>)}

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
                  onDrop={handlePlayerDrop}
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
                      <IconButton edge="end" size="small" data-testid={`remove-player-${player.id}`} onClick={() => openLeaveDialog(player.id, "organizer")}>
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
                      <span style={{ display: "inline-flex", alignItems: "center", marginRight: 4 }}>
                        <PlayerAvatar userId={player.userId} name={player.name} image={player.image} />
                      </span>
                    </Tooltip>
                  ) : (
                    <Tooltip title={t("anonymousPlayer")}>
                      <span style={{ display: "inline-flex", alignItems: "center", marginRight: 4 }}>
                        <AnonymousPlayerIcon />
                      </span>
                    </Tooltip>
                  )}
                   <ListItemText
                     primary={player.userId ? (
                       <a href={`/users/${player.userId}`} style={{ textDecoration: "none", color: "inherit", fontWeight: 500 }}>
                         {player.name}
                       </a>
                     ) : player.name}
                     slotProps={{
                       primary: { sx: { fontWeight: 500, fontSize: "0.9rem" } }
                     }}
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
                  const globalIndex = maxPlayers + i;
                  return (
                    <ListItem
                      key={player.id}
                      draggable={isOwner}
                      onDragStart={() => handlePlayerDragStart(player.id, globalIndex)}
                      onDragOver={(e) => handlePlayerDragOver(e, globalIndex)}
                      onDrop={handlePlayerDrop}
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
                          <IconButton edge="end" size="small" data-testid={`remove-bench-player-${player.id}`} onClick={() => openLeaveDialog(player.id, "organizer")}>
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
                          <span style={{ display: "inline-flex", alignItems: "center", marginRight: 4 }}>
                            <PlayerAvatar userId={player.userId} name={player.name} image={player.image} />
                          </span>
                        </Tooltip>
                      ) : (
                        <Tooltip title={t("anonymousPlayer")}>
                          <span style={{ display: "inline-flex", alignItems: "center", marginRight: 4 }}>
                            <AnonymousPlayerIcon />
                          </span>
                        </Tooltip>
                      )}
                      <ListItemText
                        primary={player.userId ? (
                          <a href={`/users/${player.userId}`} style={{ textDecoration: "none", color: "inherit", fontWeight: 500 }}>
                            {`${i + 1}. ${player.name}`}
                          </a>
                        ) : `${i + 1}. ${player.name}`}
                        slotProps={{
                          primary: { sx: { fontWeight: 500, fontSize: "0.9rem" } }
                        }}
                      />
                    </ListItem>
                  );
                })}
              </List>
            </Paper>
          </>
        )}

        {invited && invited.length > 0 && (
          <>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <ScheduleSendIcon fontSize="small" color="primary" />
              <Typography variant="body2" fontWeight={600} color="primary.main">
                {t("invitedPlayers", { n: invited.length })}
              </Typography>
            </Box>
            <Paper variant="outlined" sx={{
              p: 1,
              backgroundColor: alpha(theme.palette.primary.main, 0.04),
              borderColor: alpha(theme.palette.primary.main, 0.3),
            }}>
              <List dense disablePadding>
                {invited.map((d) => {
                  const channelsUsed = sentChannels(d.channels);
                  const eligibility = resendEligibility(d.notifiedAt, now);
                  const inviteIdForAction = (d as { inviteId?: string | null }).inviteId ?? d.id;
                  const resending = resendingInviteId === inviteIdForAction || resendingInviteId === d.id;
                  const canResend = canManageInvites && !!onResendInvite;
                  const retracting = retractingInviteId === inviteIdForAction || retractingInviteId === d.id;
                  const canRetract = canManageInvites && !!onRetractInvite;
                  return (
                    <ListItem key={d.id} sx={{ borderRadius: 2, px: 1, py: 0.5, overflow: "hidden" }}>
                      {d.userId ? (
                        <Tooltip title={t("protectedPlayer")}>
                          <span style={{ display: "inline-flex", alignItems: "center", marginRight: 4 }}>
                            <PlayerAvatar userId={d.userId} name={d.name} image={d.image ?? null} />
                          </span>
                        </Tooltip>
                      ) : (
                        <Tooltip title={t("anonymousPlayer")}>
                          <span style={{ display: "inline-flex", alignItems: "center", marginRight: 4 }}>
                            <AnonymousPlayerIcon />
                          </span>
                        </Tooltip>
                      )}
                      <ListItemText
                        primary={d.userId ? (
                          <a href={`/users/${d.userId}`} style={{ textDecoration: "none", color: "inherit", fontWeight: 500 }}>
                            {d.name}
                          </a>
                        ) : d.name}
                        slotProps={{
                          primary: {
                            sx: { fontWeight: 500, fontSize: "0.9rem" },
                            noWrap: true,
                          },
                        }}
                        sx={{ minWidth: 0, mr: 1 }}
                      />
                      {/* Right cluster: delivery channels + status + resend action.
                          flexShrink:0 keeps controls intact; the name truncates instead. */}
                      <Stack direction="row" alignItems="center" spacing={0.5} sx={{ flexShrink: 0 }}>
                        {/* ADR 0025 follow-up: how this invite was delivered —
                            icon-only below sm (touch-friendly, no wrapping),
                            icon + label from sm up. */}
                        {channelsUsed.map((c) => (
                          <ChannelChip
                            key={c.key}
                            channelKey={c.key}
                            labelKey={c.labelKey}
                            compact={!isWide}
                            inviteId={inviteIdForAction}
                          />
                        ))}
                        {channelsUsed.length === 0 && isWide && (
                          <Tooltip title={t("inviteLinkOnly")}>
                            <Chip size="small" variant="outlined" color="default" icon={<LinkIcon fontSize="small" />} label={t("inviteLinkOnlyShort")} data-testid={`invite-linkonly-${inviteIdForAction}`} />
                          </Tooltip>
                        )}
                        <Chip size="small" variant="outlined" color="primary" label={t("invitePendingLabel")} />
                        {canResend && eligibility.eligible && (
                          <Tooltip title={t("inviteResendAria", { name: d.name })}>
                            <span>
                              <IconButton
                                edge="end"
                                size="small"
                                disabled={resending}
                                data-testid={`resend-invite-${inviteIdForAction}`}
                                aria-label={t("inviteResendAria", { name: d.name })}
                                onClick={() => void onResendInvite!({ id: d.id, inviteId: inviteIdForAction, name: d.name })}
                                sx={{ p: 1 }}
                              >
                                {resending ? <CircularProgress size={16} /> : <SendIcon fontSize="small" />}
                              </IconButton>
                            </span>
                          </Tooltip>
                        )}
                        {canResend && !eligibility.eligible && (
                          // Cooldown shown as a live chip instead of a dead button:
                          // users see WHY resending isn't possible and for how long,
                          // without relying on hover tooltips (useless on touch).
                          // useNow() re-renders every 30s; when the cooldown elapses
                          // the chip flips to an active resend button automatically.
                          <Tooltip title={t("inviteResendCooldown", { time: formatCooldown(eligibility.remainingMs) })}>
                            <Chip
                              size="small"
                              variant="outlined"
                              color="default"
                              icon={<ScheduleSendIcon fontSize="small" />}
                              label={
                                <Typography component="span" variant="caption" sx={{ lineHeight: 1, fontSize: "0.7rem" }} aria-hidden>
                                  {formatCooldown(eligibility.remainingMs)}
                                </Typography>
                              }
                              data-testid={`resend-cooldown-${d.id}`}
                              aria-label={t("inviteResendCooldown", { time: formatCooldown(eligibility.remainingMs) })}
                            />
                          </Tooltip>
                        )}
                        {canRetract && (
                          <Tooltip title={t("inviteRetractAria", { name: d.name })}>
                            <span>
                              <IconButton
                                edge="end"
                                size="small"
                                disabled={retracting}
                                data-testid={`retract-invite-${inviteIdForAction}`}
                                aria-label={t("inviteRetractAria", { name: d.name })}
                                onClick={() => void onRetractInvite!({ id: d.id, inviteId: inviteIdForAction, name: d.name })}
                                sx={{ p: 1, color: theme.palette.error.main }}
                              >
                                {retracting ? <CircularProgress size={16} /> : <PersonRemoveIcon fontSize="small" />}
                              </IconButton>
                            </span>
                          </Tooltip>
                        )}
                      </Stack>
                    </ListItem>
                  );
                })}
              </List>
            </Paper>
          </>
        )}

        {declined && declined.length > 0 && (
          <>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <DoNotDisturbAltIcon fontSize="small" color="action" />
              <Typography variant="body2" fontWeight={600} color="text.secondary">
                {t("declinedPlayers", { n: declined.length })}
              </Typography>
              <Box sx={{ flexGrow: 1 }} />
              <IconButton
                size="small"
                onClick={() => setDeclinedOpen((v) => !v)}
                data-testid="declined-toggle"
                aria-label={declinedOpen ? "Collapse" : "Expand"}
              >
                {declinedOpen ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
              </IconButton>
            </Box>
            <Collapse in={declinedOpen} data-testid="declined-collapse">
              <Paper variant="outlined" sx={{
                p: 1,
                backgroundColor: theme.palette.mode === "dark"
                  ? alpha(theme.palette.grey[800], 0.5)
                  : alpha(theme.palette.action.hover, 0.35),
                borderColor: theme.palette.divider,
              }}>
                <List dense disablePadding>
                  {declined.map((d) => (
                    <ListItem key={d.id} sx={{ borderRadius: 2, px: 1, py: 0.5 }}>
                      {d.userId ? (
                        <Tooltip title={t("protectedPlayer")}>
                          <span style={{ display: "inline-flex", alignItems: "center", marginRight: 4 }}>
                            <PlayerAvatar userId={d.userId} name={d.name} image={d.image ?? null} />
                          </span>
                        </Tooltip>
                      ) : (
                        <Tooltip title={t("anonymousPlayer")}>
                          <span style={{ display: "inline-flex", alignItems: "center", marginRight: 4 }}>
                            <AnonymousPlayerIcon />
                          </span>
                        </Tooltip>
                      )}
                      <ListItemText
                        primary={d.userId ? (
                          <a href={`/users/${d.userId}`} style={{ textDecoration: "none", color: "inherit", fontWeight: 500 }}>
                            {d.name}
                          </a>
                        ) : d.name}
                        slotProps={{ primary: { sx: { fontWeight: 500, fontSize: "0.9rem", color: "text.secondary" } } }}
                      />
                      <Chip size="small" variant="outlined" color="default" label={t("declinedLabel")} />
                    </ListItem>
                  ))}
                </List>
              </Paper>
            </Collapse>
          </>
        )}

        <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 2 }}>
          <Button variant="contained" size="large" startIcon={<ShuffleIcon />}
            disabled={active.length < 2 || isRandomizing}
            aria-busy={isRandomizing ? "true" : undefined}
            sx={{ px: 4, py: 1.5 }}
            onClick={() => hasTeams ? onConfirmReRandomize() : onRandomize()}>
            {t("randomizeTeams")}
          </Button>
        </Box>

        <ConfirmLeaveDialog
          open={leaveDialog.open}
          onClose={closeLeaveDialog}
          onConfirm={confirmLeave}
          context={leaveDialog.context}
          playerName={leaveDialog.playerName}
          benchEmptyAfter={leaveDialog.benchEmptyAfter}
          within48h={leaveDialog.within48h}
          busy={leaveDialog.busy}
        />
      </Stack>
    </Paper>
  );
}


