import React, { useState, useCallback, useRef } from "react";
import {
  Paper, Typography, Box, Stack, Chip, Button, Alert,
  IconButton, Tooltip, InputAdornment, TextField, Autocomplete,
  List, ListItem, ListItemText, Menu, MenuItem, ListItemIcon, Divider,
  alpha, useTheme, LinearProgress,
} from "@mui/material";
import PersonAddIcon from "@mui/icons-material/PersonAdd";
import ShuffleIcon from "@mui/icons-material/Shuffle";
import CloseIcon from "@mui/icons-material/Close";
import AirlineSeatReclineNormalIcon from "@mui/icons-material/AirlineSeatReclineNormal";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import ShieldIcon from "@mui/icons-material/Shield";
import ContactsIcon from "@mui/icons-material/Contacts";
import HowToRegIcon from "@mui/icons-material/HowToReg";
import CancelIcon from "@mui/icons-material/Cancel";
import HelpOutlineIcon from "@mui/icons-material/HelpOutlined";
import BackspaceIcon from "@mui/icons-material/Backspace";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import { useT } from "~/lib/useT";
import { matchesWithName } from "~/lib/stringMatch";
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

interface PlayerSuggestion {
  name: string;
  gamesPlayed: number;
  userId?: string | null;
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
  canRemovePlayer: (player: Player) => boolean;
  // #XXX Attendance UI (simplified — Quick Join / Quick Leave / You row are gone; replaced by AttendanceCta)
  /** Current authenticated user's id, if any. When set, the AttendanceCta is rendered above the list. */
  currentUserId?: string | null;
  /** Current user's RSVP status, fetched separately. */
  myRsvpStatus?: RsvpStatus;
  /** Map of guest-playerId → RSVP status. When provided, every guest row renders an inline pill. */
  guestRsvpMap?: Record<string, RsvpStatus>;
  /** Map of linked-userId → RSVP status. Only rendered when the viewer is logged in
   *  (one-way privacy — anonymous viewers never see logged-user RSVPs). The viewer's
   *  own row is intentionally skipped because the AttendanceCta carries that answer. */
  userRsvpMap?: Record<string, RsvpStatus>;
  /** True for the owner or an admin. Controls whether the guest pill is clickable. */
  canEditGuestAttendance?: boolean;
  /** Set the current user's own RSVP. */
  onSetMyRsvp?: (status: "yes" | "no") => Promise<void>;
  /** Set a guest player's RSVP (owner/admin only). Pass null to clear. */
  onSetGuestRsvp?: (playerId: string, status: RsvpStatus) => Promise<void>;
  /** Called by AttendanceCta's "Going" button when the user is NOT on the list. The parent
   *  typically routes this through the payment-nudge dialog before adding the user. */
  onJoinAsSelf?: () => void;
  // #XXX Leave flow
  /** ISO dateTime of the event. Used to determine if we're within 48h before kickoff for the leave-warning copy. */
  eventDateTime?: string;
}

export function PlayerList({
  players, maxPlayers, isOwner, hasTeams,
  availableSuggestions, playerError, onPlayerErrorChange,
  onAddPlayer, onRequestAdd, onRemovePlayer, onReorderPlayers, onResetPlayerOrder,
  onRandomize, onConfirmReRandomize, canRemovePlayer,
  currentUserId,
  myRsvpStatus: _myRsvpStatus,
  guestRsvpMap,
  userRsvpMap,
  canEditGuestAttendance,
  onSetMyRsvp,
  onSetGuestRsvp,
  onJoinAsSelf: _onJoinAsSelf,
  eventDateTime,
}: Props) {
  const t = useT();
  const theme = useTheme();
  const [playerInput, setPlayerInput] = useState("");

  // Detect if the current input looks like an email address
  const isEmailInput = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(playerInput.trim());

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

  // #XXX Attendance — the user's own player record (null if not on the list).
  // Drives the "Join this game" vs "Going" copy on the AttendanceCta.
  const _myPlayer: Player | undefined = currentUserId
    ? players.find((p) => p.userId === currentUserId)
    : undefined;

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
              if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
                // Email address — direct add (typing is deliberate).
                onAddPlayer(val.split("@")[0], val);
              } else if (onRequestAdd) {
                // Dropdown row tap — single-tap surface, requires confirmation.
                onRequestAdd({ kind: "single", name: val, source: "dropdown" });
              } else {
                onAddPlayer(val);
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
                    // Email detection: submit as email invite
                    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
                      e.preventDefault();
                      e.stopPropagation();
                      onAddPlayer(trimmed.split("@")[0], trimmed);
                      setPlayerInput("");
                      return;
                    }
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
                    onAddPlayer(trimmed);
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

                  htmlInput: { ...params.slotProps.htmlInput, maxLength: 120 }
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
                        <ShieldIcon fontSize="small" sx={{ color: "primary.main", flexShrink: 0 }} />
                      </Tooltip>
                    ) : null}
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{option.name}</span>
                  </Box>
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

          <IconButton
            color="primary"
            data-testid="add-player-submit"
            aria-label={t("addPlayerSubmit")}
            disabled={!playerInput.trim()}
            onClick={() => {
              const trimmed = playerInput.trim();
              if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
                onAddPlayer(trimmed.split("@")[0], trimmed);
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

        <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
          {isEmailInput ? t("inviteByEmailHelper") : t("addPlayerOrEmailHelper")}
        </Typography>

        {contactPickerSupported && (
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", fontStyle: "italic" }}>
            {t("addFromContactsHint")}
          </Typography>
        )}

        {/* Recent players chips (organizer convenience for re-adding past players).
            The self Quick Join / Quick Leave pills are gone — replaced by the AttendanceCta below. */}
        {availableSuggestions.length > 0 && !playerInput.trim() && (
          <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 0.75 }}>
              {t("recentPlayers")}:
            </Typography>
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
              {availableSuggestions.slice(0, 12).map((s) => (
                <Chip
                  key={s.name}
                  icon={s.userId ? <ShieldIcon sx={{ color: "primary.main !important" }} /> : undefined}
                  label={s.name}
                  variant="outlined"
                  size="small"
                  onClick={() => {
                    if (onRequestAdd) {
                      onRequestAdd({ kind: "single", name: s.name, source: "chip" });
                    } else {
                      onAddPlayer(s.name);
                    }
                  }}
                  title={s.userId ? t("protectedPlayer") : undefined}
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
                    <Stack direction="row" spacing={0.5} alignItems="center">
                      {/* #XXX Guest attendance pill — visible to all, clickable to owner/admin only. */}
                      {player.userId === null && guestRsvpMap && (
                        <GuestAttendancePill
                          playerId={player.id}
                          status={guestRsvpMap[player.id] ?? null}
                          canEdit={!!canEditGuestAttendance}
                          onSet={onSetGuestRsvp ? (status) => onSetGuestRsvp(player.id, status) : undefined}
                          onRequestDecline={canEditGuestAttendance
                            ? () => openLeaveDialog(player.id, "organizer")
                            : undefined}
                        />
                      )}
                      {/* #XXX User attendance pill — read-only status for a linked user. Visible
                          only to logged viewers (one-way privacy); the viewer's own row is
                          skipped so the AttendanceCta at the top carries their answer. */}
                      {player.userId !== null && player.userId !== undefined && currentUserId && player.userId !== currentUserId && userRsvpMap && userRsvpMap[player.userId] !== undefined && (
                        <UserRsvpPill userId={player.userId} status={userRsvpMap[player.userId] ?? null} />
                      )}
                      {canRemovePlayer(player) ? (
                        <IconButton edge="end" size="small" data-testid={`remove-player-${player.id}`} onClick={() => openLeaveDialog(player.id, "organizer")}>
                          <CloseIcon fontSize="small" />
                        </IconButton>
                      ) : undefined}
                    </Stack>
                  }
                >
                  {isOwner && (
                    <DragIndicatorIcon fontSize="small" sx={{ color: "text.disabled", mr: 0.5, flexShrink: 0 }} />
                  )}
                  {player.userId ? (
                     <Tooltip title={t("protectedPlayer")}>
                       <ShieldIcon fontSize="small" sx={{ color: "primary.main", mr: 0.5, flexShrink: 0 }} />
                     </Tooltip>
                   ) : null}
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
                          <ShieldIcon fontSize="small" sx={{ color: "warning.main", mr: 0.5, flexShrink: 0 }} />
                        </Tooltip>
                      ) : null}
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

        <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 2 }}>
          <Button variant="contained" size="large" startIcon={<ShuffleIcon />}
            disabled={active.length < 2} sx={{ px: 4, py: 1.5 }}
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

/**
 * #XXX Guest attendance pill + owner/admin menu.
 * - Non-admin viewers: read-only chip showing the current state.
 * - Owner/admin: click → small popover with 3 status options + a Clear action.
 *   The "Declined" option routes through the confirm-leave dialog (it also archives the player).
 */
function GuestAttendancePill({
  playerId, status, canEdit, onSet, onRequestDecline,
}: {
  playerId: string;
  status: RsvpStatus;
  canEdit: boolean;
  onSet?: (status: RsvpStatus) => void;
  onRequestDecline?: () => void;
}) {
  const t = useT();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const open = !!anchorEl;
  const handleOpen = (e: React.MouseEvent<HTMLElement>) => {
    if (!canEdit) return;
    e.stopPropagation();
    setAnchorEl(e.currentTarget);
  };
  const handleClose = () => setAnchorEl(null);
  const pick = (next: RsvpStatus) => {
    handleClose();
    if (next === "no") {
      // Declining a guest = leave flow (archive + Rsvp.no). The parent routes through confirm-leave.
      onRequestDecline?.();
    } else {
      onSet?.(next);
    }
  };

  const chip = (
    <Chip
      size="small"
      data-testid={`rsvp-guest-pill-${playerId}`}
      data-status={status ?? "none"}
      icon={status === "yes"
        ? <HowToRegIcon />
        : status === "no"
          ? <CancelIcon />
          : <HelpOutlineIcon />}
      label={status === "yes"
        ? t("rsvpGoing")
        : status === "no"
          ? t("rsvpDeclined")
          : t("rsvpNoResponse")}
      color={status === "yes" ? "success" : status === "no" ? "error" : "default"}
      variant={canEdit ? "filled" : "outlined"}
      onClick={handleOpen}
      sx={{
        cursor: canEdit ? "pointer" : "default",
        pointerEvents: canEdit ? "auto" : "none",
      }}
    />
  );

  return (
    <>
      {canEdit
        ? <Tooltip title={t("guestPillMenuSet")}>{chip}</Tooltip>
        : <Tooltip title={t("rsvpSetByOrganizer")}><span>{chip}</span></Tooltip>}
      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        data-testid={`rsvp-guest-menu-${playerId}`}
      >
        <MenuItem
          data-testid={`rsvp-guest-menu-going-${playerId}`}
          selected={status === "yes"}
          onClick={() => pick("yes")}
        >
          <ListItemIcon><HowToRegIcon fontSize="small" /></ListItemIcon>
          {t("rsvpGoing")}
        </MenuItem>
        <MenuItem
          data-testid={`rsvp-guest-menu-declined-${playerId}`}
          selected={status === "no"}
          onClick={() => pick("no")}
        >
          <ListItemIcon><CancelIcon fontSize="small" /></ListItemIcon>
          {t("rsvpDeclined")}
        </MenuItem>
        <MenuItem
          data-testid={`rsvp-guest-menu-noresponse-${playerId}`}
          selected={status === null}
          onClick={() => pick(null)}
        >
          <ListItemIcon><HelpOutlineIcon fontSize="small" /></ListItemIcon>
          {t("rsvpNoResponse")}
        </MenuItem>
        {status !== null && (
          [
            <Divider key="divider" />,
            <MenuItem
              key="clear"
              data-testid={`rsvp-guest-menu-clear-${playerId}`}
              onClick={() => pick(null)}
            >
              <ListItemIcon><BackspaceIcon fontSize="small" /></ListItemIcon>
              {t("guestPillMenuClear")}
            </MenuItem>,
          ]
        )}
      </Menu>
    </>
  );
}

/**
 * #XXX User attendance pill — read-only status badge on a linked-user row.
 * Visible only to logged viewers (the server-side `getUserRsvpMap` enforces this).
 * No menu: the user can only RSVP for themselves, via the AttendanceCta at the top
 * of the list. Their own row is skipped by the parent so we don't render two pills.
 */
function UserRsvpPill({ userId, status }: { userId: string; status: RsvpStatus }) {
  const t = useT();
  return (
    <Chip
      size="small"
      data-testid={`rsvp-user-pill-${userId}`}
      data-status={status ?? "none"}
      icon={status === "yes"
        ? <HowToRegIcon />
        : status === "maybe"
          ? <HelpOutlineIcon />
          : status === "no"
            ? <CancelIcon />
            : <HelpOutlineIcon />}
      label={status === "yes"
        ? t("rsvpGoing")
        : status === "maybe"
          ? t("rsvpMaybe")
          : status === "no"
            ? t("rsvpDeclined")
            : t("rsvpNoResponse")}
      color={status === "yes" ? "success" : status === "no" ? "error" : status === "maybe" ? "warning" : "default"}
      variant="outlined"
      sx={{ pointerEvents: "none" }}
    />
  );
}
