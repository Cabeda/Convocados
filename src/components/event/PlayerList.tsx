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

import RestartAltIcon from "@mui/icons-material/RestartAlt";
import { useT } from "~/lib/useT";
import { matchesWithName } from "~/lib/stringMatch";
import type { Player, PlayerOption } from "./types";

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
}

export function PlayerList({
  players, maxPlayers, isOwner, hasTeams,
  availableSuggestions, playerError, onPlayerErrorChange,
  onAddPlayer, onRemovePlayer, onReorderPlayers, onResetPlayerOrder,
  onRandomize, onConfirmReRandomize, canRemovePlayer,
  quickJoinUserName,
  onQuickJoinPillClick,
}: Props) {
  const t = useT();
  const theme = useTheme();
  const [playerInput, setPlayerInput] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");

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
        setInviteEmail("");
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

        <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems="stretch">
          <Autocomplete<PlayerOption, false, false, true>
            sx={{ flex: 2, minWidth: 0 }}
            freeSolo
            options={(() => {
              const trimmed = playerInput.trim();
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
              if (typeof newValue === "string") {
                if (newValue.trim()) { onAddPlayer(newValue); setPlayerInput(""); }
              } else {
                onAddPlayer(newValue.name);
                setPlayerInput("");
              }
            }}
            renderInput={(params) => (
              <TextField
                {...params}
                variant="outlined"
                size="small"
                placeholder={inviteEmail.trim() ? t("addPlayerPlaceholderOptional") : t("addPlayerPlaceholder")}
                fullWidth
                inputProps={{ ...params.inputProps, maxLength: 50 }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const trimmed = playerInput.trim();
                    if (!trimmed && !inviteEmail.trim()) return;
                    if (trimmed) {
                      const hasExactMatch = availableSuggestions.some(
                        (s) => s.name.toLowerCase() === trimmed.toLowerCase()
                      );
                      if (hasExactMatch) return;
                      const hasPartialMatch = availableSuggestions.some(
                        (s) => matchesWithName(s.name, trimmed)
                      );
                      if (hasPartialMatch) return;
                    }
                    e.preventDefault();
                    e.stopPropagation();
                    onAddPlayer(trimmed, inviteEmail.trim() || undefined);
                    setPlayerInput("");
                    setInviteEmail("");
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
                return (
                  <li key={key} {...otherProps} style={{ minHeight: 44, fontStyle: "italic", display: "flex", alignItems: "center", gap: 8 }}>
                    <PersonAddIcon fontSize="small" color="primary" />
                    {t("createNewPlayer", { name: option.name })}
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

          <TextField
            type="email"
            size="small"
            variant="outlined"
            sx={{ flex: 1.4, minWidth: { xs: 0, sm: 200 } }}
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            placeholder={t("inviteByEmailPlaceholder")}
            inputProps={{ inputMode: "email", maxLength: 120, "aria-label": t("inviteByEmailPlaceholder") }}
          />

          <IconButton
            color="primary"
            data-testid="add-player-submit"
            aria-label={t("addPlayerSubmit")}
            disabled={!playerInput.trim() && !inviteEmail.trim()}
            onClick={() => {
              onAddPlayer(playerInput.trim(), inviteEmail.trim() || undefined);
              setPlayerInput("");
              setInviteEmail("");
            }}
            sx={{ alignSelf: "stretch", borderRadius: 1, border: 1, borderColor: "divider", px: 1.5 }}
          >
            <PersonAddIcon />
          </IconButton>
        </Stack>

        <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
          {playerInput.trim() || inviteEmail.trim() ? t("addPlayerHelper") : t("inviteByEmailHelper")}
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
          const showRecents = availableSuggestions.length > 0;
          const idle = !playerInput.trim() && !inviteEmail.trim();
          if (!idle || (!showQuickJoin && !showRecents)) return null;

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
                {showRecents && availableSuggestions.slice(0, 12).map((s) => (
                  <Chip
                    key={s.name}
                    icon={s.userId ? <ShieldIcon sx={{ color: "primary.main !important" }} /> : undefined}
                    label={s.name}
                    variant="outlined"
                    size="small"
                    onClick={() => { onAddPlayer(s.name); }}
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
      </Stack>
    </Paper>
  );
}
