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

interface PlayerSuggestion {
  name: string;
  gamesPlayed: number;
}

interface Props {
  players: Player[];
  maxPlayers: number;
  isOwner: boolean;
  canClaimPlayer: boolean;
  hasTeams: boolean;
  availableSuggestions: PlayerSuggestion[];
  playerError: string | null;
  onPlayerErrorChange: (error: string | null) => void;
  onAddPlayer: (name: string) => Promise<void>;
  onRemovePlayer: (playerId: string) => Promise<void>;
  onReorderPlayers: (playerIds: string[]) => Promise<void>;
  onResetPlayerOrder: () => Promise<void>;
  onRandomize: () => void;
  onConfirmReRandomize: () => void;
  onOpenClaimPlayerDialog: (playerId: string, playerName: string) => void;
  canRemovePlayer: (player: Player) => boolean;
}

export function PlayerList({
  players, maxPlayers, isOwner, canClaimPlayer, hasTeams,
  availableSuggestions, playerError, onPlayerErrorChange,
  onAddPlayer, onRemovePlayer, onReorderPlayers, onResetPlayerOrder,
  onRandomize, onConfirmReRandomize, onOpenClaimPlayerDialog, canRemovePlayer,
}: Props) {
  const t = useT();
  const theme = useTheme();
  const [playerInput, setPlayerInput] = useState("");

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
              .map((s) => ({ type: "existing" as const, name: s.name, gamesPlayed: s.gamesPlayed }));
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
              placeholder={t("addPlayerPlaceholder")}
              helperText={t("addPlayerHelper")}
              fullWidth
              inputProps={{ ...params.inputProps, maxLength: 50 }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && playerInput.trim()) {
                  const trimmed = playerInput.trim();
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
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton color="primary" edge="end"
                      disabled={!playerInput.trim()}
                      onClick={() => { onAddPlayer(playerInput); setPlayerInput(""); }}>
                      <PersonAddIcon />
                    </IconButton>
                  </InputAdornment>
                ),
              }}
            />
          )}
          renderOption={(props, option) => {
            const { key, ...otherProps } = props as any;
            if (option.type === "create") {
              return (
                <li key={key} {...otherProps} style={{ minHeight: 44, fontStyle: "italic", display: "flex", alignItems: "center", gap: 8 }}>
                  <PersonAddIcon fontSize="small" color="primary" />
                  {t("createNewPlayer", { name: option.name })}
                </li>
              );
            }
            return (
              <li key={key} {...otherProps} style={{ minHeight: 44, display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
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
                  onClick={() => { onAddPlayer(s.name); }}
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
                  ) : canClaimPlayer ? (
                    <Chip
                      label={t("thisIsMe")}
                      size="small"
                      variant="outlined"
                      color="info"
                      onClick={() => onOpenClaimPlayerDialog(player.id, player.name)}
                      sx={{ mr: 0.5, flexShrink: 0, cursor: "pointer", fontSize: "0.7rem", height: 22 }}
                    />
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
                      ) : canClaimPlayer ? (
                        <Chip
                          label={t("thisIsMe")}
                          size="small"
                          variant="outlined"
                          color="info"
                          onClick={() => onOpenClaimPlayerDialog(player.id, player.name)}
                          sx={{ mr: 0.5, flexShrink: 0, cursor: "pointer", fontSize: "0.7rem", height: 22 }}
                        />
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
