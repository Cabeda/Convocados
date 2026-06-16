import React, { useState, useCallback } from "react";
import {
  Paper, Typography, Box, Stack, Chip, Button, Alert,
  IconButton, Tooltip, InputAdornment, TextField, Autocomplete,
  List, ListItem, ListItemText, alpha, useTheme,
} from "@mui/material";
import PersonAddIcon from "@mui/icons-material/PersonAdd";
import ShuffleIcon from "@mui/icons-material/Shuffle";
import CloseIcon from "@mui/icons-material/Close";
import AirlineSeatReclineNormalIcon from "@mui/icons-material/AirlineSeatReclineNormal";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import ShieldIcon from "@mui/icons-material/Shield";

import RestartAltIcon from "@mui/icons-material/RestartAlt";
import { useT } from "~/lib/useT";
import { matchesWithName } from "~/lib/stringMatch";
import type { Player, PlayerOption } from "./types";
import type { AddPlayerIntent } from "./AddPlayerConfirmDialog";

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
  onRequestAdd: (intent: AddPlayerIntent) => void;
  onRemovePlayer: (playerId: string) => Promise<void>;
  onReorderPlayers: (playerIds: string[]) => Promise<void>;
  onResetPlayerOrder: () => Promise<void>;
  onRandomize: () => void;
  onConfirmReRandomize: () => void;
  canRemovePlayer: (player: Player) => boolean;
  /** Live invite-email value, used by the confirmation dialog's email footnote. */
  inviteEmail?: string;
  onInviteEmailChange?: (value: string) => void;
}

export function PlayerList({
  players, maxPlayers, isOwner, hasTeams,
  availableSuggestions, playerError, onPlayerErrorChange,
  onAddPlayer, onRequestAdd, onRemovePlayer, onReorderPlayers, onResetPlayerOrder,
  onRandomize, onConfirmReRandomize, canRemovePlayer, inviteEmail, onInviteEmailChange,
}: Props) {
  const t = useT();
  const theme = useTheme();
  const [playerInput, setPlayerInput] = useState("");
  const [inviteEmailLocal, setInviteEmailLocal] = useState("");
  // The local state is the source of truth inside the component; we forward
  // changes to the parent via onInviteEmailChange so the confirmation dialog
  // can read the latest value.
  const setInviteEmail = (v: string) => {
    setInviteEmailLocal(v);
    onInviteEmailChange?.(v);
  };
  const inviteEmailDisplay = inviteEmail ?? inviteEmailLocal;

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

        <Autocomplete<PlayerOption, false, false, true>
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
              // Dropdown row tap — single-tap surface, requires confirmation.
              onRequestAdd({ kind: "single", name: newValue.name, email: inviteEmailDisplay.trim() || undefined, source: "dropdown" });
              setPlayerInput("");
            }
          }}
          renderInput={(params) => (
            <TextField
              {...params}
              variant="outlined"
              placeholder={inviteEmailDisplay.trim() ? t("addPlayerPlaceholderOptional") : t("addPlayerPlaceholder")}
              helperText={t("addPlayerHelper")}
              fullWidth
              inputProps={{ ...params.inputProps, maxLength: 50 }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const trimmed = playerInput.trim();
                  // Allow submission with empty name when email is provided
                  if (!trimmed && !inviteEmailDisplay.trim()) return;
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
                  onAddPlayer(trimmed, inviteEmailDisplay.trim() || undefined);
                  setPlayerInput("");
                  setInviteEmail("");
                }
              }}
              InputProps={{
                ...params.InputProps,
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton color="primary" edge="end"
                      disabled={!playerInput.trim() && !inviteEmailDisplay.trim()}
                      onClick={() => { onAddPlayer(playerInput.trim(), inviteEmailDisplay.trim() || undefined); setPlayerInput(""); setInviteEmail(""); }}>
                      <PersonAddIcon />
                    </IconButton>
                  </InputAdornment>
                ),
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

        {/* Optional: notify a registered player or email an invite to register */}
        <TextField
          type="email"
          size="small"
          variant="outlined"
          fullWidth
          value={inviteEmailDisplay}
          onChange={(e) => {
            setInviteEmail(e.target.value);
          }}
          placeholder={t("inviteByEmailPlaceholder")}
          helperText={t("inviteByEmailHelper")}
          inputProps={{ inputMode: "email", maxLength: 120 }}
          sx={{ mt: 1 }}
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
                  icon={s.userId ? <ShieldIcon sx={{ color: "primary.main !important" }} /> : undefined}
                  label={s.name}
                  variant="outlined"
                  size="small"
                  onClick={() => { onRequestAdd({ kind: "single", name: s.name, email: inviteEmailDisplay.trim() || undefined, source: "chip" }); }}
                  title={s.userId ? t("protectedPlayer") : undefined}
                  sx={{
                    cursor: "pointer",
                    minHeight: 32,
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
