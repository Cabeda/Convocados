import React, { useState, useCallback } from "react";
import {
  Paper, Typography, Box, Stack, Chip, Button, Alert,
  IconButton, Tooltip, InputAdornment, TextField, Autocomplete,
  List, ListItem, ListItemText, alpha, useTheme,
} from "@mui/material";
import PersonAddIcon from "@mui/icons-material/PersonAdd";
import EmojiPeopleIcon from "@mui/icons-material/EmojiPeople";
import ShuffleIcon from "@mui/icons-material/Shuffle";
import CloseIcon from "@mui/icons-material/Close";
import AirlineSeatReclineNormalIcon from "@mui/icons-material/AirlineSeatReclineNormal";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import ShieldIcon from "@mui/icons-material/Shield";
import ContactsIcon from "@mui/icons-material/Contacts";
import HowToRegIcon from "@mui/icons-material/HowToReg";
import CancelIcon from "@mui/icons-material/Cancel";
import HelpOutlineIcon from "@mui/icons-material/HelpOutline";
import CheckIcon from "@mui/icons-material/Check";
import RemoveIcon from "@mui/icons-material/Remove";

import RestartAltIcon from "@mui/icons-material/RestartAlt";
import ExitToAppIcon from "@mui/icons-material/ExitToApp";
import { useT } from "~/lib/useT";
import { matchesWithName } from "~/lib/stringMatch";
import type { Player, PlayerOption } from "./types";
import type { AddPlayerIntent } from "./AddPlayerConfirmDialog";
import { AttendanceCard } from "./AttendanceCard";

export type RsvpStatus = "yes" | "no" | null;

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
  /** When provided (authenticated user), renders a "Join this game as {name}" pill as the first pill. */
  quickJoinUserName?: string;
  /** Optional: if provided, the Quick Join pill calls this instead of joining directly.
      The host typically opens the payment-nudge dialog from here when the user has a balance. */
  onQuickJoinPillClick?: (name: string) => void;
  /** Called when the user clicks the "Leave game" pill. Removes the user's player entry. */
  onQuickLeave?: () => void;
  // #XXX Attendance UI
  /** Current authenticated user's id, if any. When set, a "You" row is rendered at the top of the active list. */
  currentUserId?: string | null;
  /** Current user's RSVP status, fetched separately. When currentUserId is set, the You row uses this to render its current state. */
  myRsvpStatus?: RsvpStatus;
  /** Map of guest-playerId → RSVP status. When provided, every guest row renders an inline pill. */
  guestRsvpMap?: Record<string, RsvpStatus>;
  /** True for the owner or an admin. Controls whether the guest pill is clickable. */
  canEditGuestAttendance?: boolean;
  /** Set the current user's own RSVP. */
  onSetMyRsvp?: (status: "yes" | "no") => Promise<void>;
  /** Set a guest player's RSVP (owner/admin only). Pass null to clear. */
  onSetGuestRsvp?: (playerId: string, status: RsvpStatus) => Promise<void>;
  /** When set, the AttendanceCard summary renders as a footer inside this Paper, below the player list. The card itself enforces owner/admin-only visibility. */
  attendanceSummaryEventId?: string;
}

export function PlayerList({
  players, maxPlayers, isOwner, hasTeams,
  availableSuggestions, playerError, onPlayerErrorChange,
  onAddPlayer, onRequestAdd, onRemovePlayer, onReorderPlayers, onResetPlayerOrder,
  onRandomize, onConfirmReRandomize, canRemovePlayer,
  quickJoinUserName,
  onQuickJoinPillClick,
  onQuickLeave,
  currentUserId,
  myRsvpStatus,
  guestRsvpMap,
  canEditGuestAttendance,
  onSetMyRsvp,
  onSetGuestRsvp,
  attendanceSummaryEventId,
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

  // #XXX Attendance — only show the You row if the user is on the active list as themselves
  // (covers linked players + owners). Followers-only users can use the Quick Join pill to join first.
  const myPlayerOnActiveList = !!currentUserId && active.some(
    (p) => p.userId === currentUserId,
  );
  const showYouRow = myPlayerOnActiveList && !!onSetMyRsvp;
  const youPlayer = showYouRow
    ? active.find((p) => p.userId === currentUserId)
    : undefined;

  // #XXX Attendance — guest pill click cycles Pending → Yes → No → Pending
  const cycleGuestRsvp = useCallback((playerId: string) => {
    if (!onSetGuestRsvp) return;
    const current = guestRsvpMap?.[playerId] ?? null;
    const next: RsvpStatus = current === null ? "yes" : current === "yes" ? "no" : null;
    onSetGuestRsvp(playerId, next);
  }, [guestRsvpMap, onSetGuestRsvp]);

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
              option.type === value.type && option.name === value.name
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
                inputProps={{ ...params.inputProps, maxLength: 120 }}
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
                InputProps={{
                  ...params.InputProps,
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
                }}
              />
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

        {/* Quick-join pill (first, when authenticated and not yet joined) + recent players.
            The whole row hides when the user is mid-typing, so the focus stays on the input. */}
        {(() => {
          const trimmedName = quickJoinUserName?.trim();
          const alreadyJoined = !!trimmedName && players.some(
            (p) => p.name.toLowerCase() === trimmedName.toLowerCase(),
          );
          const showQuickJoin = !!trimmedName && !alreadyJoined;
          const showQuickLeave = !!trimmedName && alreadyJoined && !!onQuickLeave;
          const showRecents = availableSuggestions.length > 0;
          const idle = !playerInput.trim();
          if (!idle || (!showQuickJoin && !showQuickLeave && !showRecents)) return null;

          return (
            <Box>
              {showRecents && (
                <Typography variant="body2" color="text.secondary" sx={{ mb: 0.75 }}>
                  {t("recentPlayers")}:
                </Typography>
              )}
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
                {showQuickJoin && (
                  <Chip
                    data-testid="quick-join-pill"
                    icon={<EmojiPeopleIcon fontSize="small" />}
                    label={t("quickJoinPillLabel", { name: trimmedName })}
                    variant="filled"
                    color="primary"
                    size="small"
                    onClick={() => {
                      if (onQuickJoinPillClick) {
                        onQuickJoinPillClick(trimmedName);
                      } else {
                        onAddPlayer(trimmedName);
                      }
                    }}
                    sx={{
                      cursor: "pointer",
                      fontWeight: 600,
                    }}
                  />
                )}
                {showQuickLeave && (
                  <Chip
                    data-testid="quick-leave-pill"
                    icon={<ExitToAppIcon fontSize="small" />}
                    label={t("quickLeavePillLabel")}
                    variant="outlined"
                    color="error"
                    size="small"
                    onClick={onQuickLeave}
                    sx={{
                      cursor: "pointer",
                      fontWeight: 600,
                    }}
                  />
                )}
                {showRecents && availableSuggestions.slice(0, 12).map((s) => (
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
          );
        })()}

        {active.length > 0 && (
          <Paper variant="outlined" sx={{
            p: 1, backgroundColor: alpha(theme.palette.primary.main, 0.06),
          }}>
            <List dense disablePadding>
              {/* #XXX "You" row — pinned at top of the active list for the signed-in user. */}
              {showYouRow && youPlayer && (
                <ListItem
                  data-testid="rsvp-you-row"
                  sx={{
                    borderRadius: 2, px: 1, py: 0.75, mb: 0.5,
                    bgcolor: alpha(theme.palette.primary.main, 0.12),
                    border: `1px solid ${alpha(theme.palette.primary.main, 0.4)}`,
                  }}
                  secondaryAction={
                    <Stack direction="row" spacing={0.5} alignItems="center">
                      {myRsvpStatus === "yes" ? (
                        <Chip
                          size="small"
                          color="success"
                          icon={<HowToRegIcon />}
                          label={t("rsvpGoing")}
                          data-testid="rsvp-you-status"
                          data-status="yes"
                        />
                      ) : myRsvpStatus === "no" ? (
                        <Chip
                          size="small"
                          color="error"
                          icon={<CancelIcon />}
                          label={t("rsvpDeclined")}
                          data-testid="rsvp-you-status"
                          data-status="no"
                        />
                      ) : (
                        <Chip
                          size="small"
                          variant="outlined"
                          icon={<HelpOutlineIcon />}
                          label={t("rsvpNoResponse")}
                          data-testid="rsvp-you-status"
                          data-status="none"
                        />
                      )}
                      <Tooltip title={t("rsvpSetGoing")}>
                        <span>
                          <IconButton
                            size="small"
                            color={myRsvpStatus === "yes" ? "success" : "default"}
                            data-testid="rsvp-you-yes"
                            disabled={myRsvpStatus === "yes" || !onSetMyRsvp}
                            onClick={() => onSetMyRsvp?.("yes")}
                            aria-label={t("rsvpSetGoing")}
                          >
                            <CheckIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                      <Tooltip title={t("rsvpSetDeclined")}>
                        <span>
                          <IconButton
                            size="small"
                            color={myRsvpStatus === "no" ? "error" : "default"}
                            data-testid="rsvp-you-no"
                            disabled={myRsvpStatus === "no" || !onSetMyRsvp}
                            onClick={() => onSetMyRsvp?.("no")}
                            aria-label={t("rsvpSetDeclined")}
                          >
                            <RemoveIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </Stack>
                  }
                >
                  <ShieldIcon fontSize="small" sx={{ color: "primary.main", mr: 0.5, flexShrink: 0 }} />
                  <ListItemText
                    primary={<span style={{ fontWeight: 700, fontSize: "0.9rem" }}>{t("rsvpYouRow")}</span>}
                    secondary={youPlayer.name}
                    secondaryTypographyProps={{ fontSize: "0.75rem", color: "text.secondary" }}
                  />
                </ListItem>
              )}
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
                        <Tooltip
                          title={canEditGuestAttendance
                            ? (guestRsvpMap[player.id] === "yes"
                                ? t("rsvpSetDeclined")
                                : guestRsvpMap[player.id] === "no"
                                  ? t("rsvpClearAttendance")
                                  : t("rsvpSetGoing"))
                            : t("rsvpSetByOrganizer")}
                        >
                          <span>
                            <Chip
                              size="small"
                              data-testid={`rsvp-guest-pill-${player.id}`}
                              data-status={guestRsvpMap[player.id] ?? "none"}
                              icon={guestRsvpMap[player.id] === "yes"
                                ? <HowToRegIcon />
                                : guestRsvpMap[player.id] === "no"
                                  ? <CancelIcon />
                                  : <HelpOutlineIcon />}
                              label={guestRsvpMap[player.id] === "yes"
                                ? t("rsvpGoing")
                                : guestRsvpMap[player.id] === "no"
                                  ? t("rsvpDeclined")
                                  : t("rsvpNoResponse")}
                              color={guestRsvpMap[player.id] === "yes"
                                ? "success"
                                : guestRsvpMap[player.id] === "no"
                                  ? "error"
                                  : "default"}
                              variant={canEditGuestAttendance ? "filled" : "outlined"}
                              onClick={canEditGuestAttendance && onSetGuestRsvp
                                ? () => cycleGuestRsvp(player.id)
                                : undefined}
                              sx={{
                                cursor: canEditGuestAttendance ? "pointer" : "default",
                                pointerEvents: canEditGuestAttendance ? "auto" : "none",
                              }}
                            />
                          </span>
                        </Tooltip>
                      )}
                      {canRemovePlayer(player) ? (
                        <IconButton edge="end" size="small" onClick={() => onRemovePlayer(player.id)}>
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
                          <IconButton edge="end" size="small" onClick={() => onRemovePlayer(player.id)}>
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
            onClick={() => hasTeams ? onConfirmReRandomize() : onRandomize()}>
            {t("randomizeTeams")}
          </Button>
        </Box>

        {attendanceSummaryEventId && (
          <AttendanceCard eventId={attendanceSummaryEventId} />
        )}
      </Stack>
    </Paper>
  );
}
