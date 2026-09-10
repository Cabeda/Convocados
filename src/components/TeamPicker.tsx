import { useState } from "react";
import {
  Box, Chip, Paper, Typography, alpha, useTheme, Stack, Avatar,
  List, ListItem, ListItemAvatar, ListItemText, IconButton, TextField,
} from "@mui/material";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import EditIcon from "@mui/icons-material/Edit";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import type { Imatch } from "~/lib/random";
import { useT } from "~/lib/useT";
import { TeamDragGhost, teamMotionKeyframes, useTeamDrag } from "./team/useTeamDrag";

interface Props {
  matches: Imatch[];
  onResultChange: (matches: Imatch[]) => void;
  onTeamNameSave?: (teamIndex: number, newName: string) => void;
  ratingsMap?: Record<string, number>;
  /** Increment when a server-side randomization starts to animate the reshuffle. */
  shuffleKey?: number;
}

export function TeamPicker({
  matches,
  onResultChange,
  onTeamNameSave,
  ratingsMap,
  shuffleKey = 0,
}: Props) {
  const theme = useTheme();
  const t = useT();
  const isDark = theme.palette.mode === "dark";

  const TEAM_COLORS = [
    theme.palette.primary,
    theme.palette.secondary,
  ];

  const [editingTeam, setEditingTeam] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState("");

  const {
    drag,
    activeDropZone,
    playerMotion,
    isShuffling,
    zonesRef,
    cancelDrag,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
  } = useTeamDrag({ matches, onResultChange, shuffleKey });

  return (
    <>
      <TeamDragGhost drag={drag} />
      <Box
        data-testid="team-picker"
        data-shuffling={isShuffling ? "true" : "false"}
        data-shuffle-key={shuffleKey}
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
          gap: 2,
          ...teamMotionKeyframes,
        }}
        onPointerMove={drag ? handlePointerMove : undefined}
        onPointerUp={drag ? handlePointerUp : undefined}
        onPointerCancel={cancelDrag}
      >
        {matches.map((team, teamIdx) => {
          const colors = TEAM_COLORS[teamIdx % TEAM_COLORS.length];
          const isActive = activeDropZone === team.team;
          const isMotionDestination = playerMotion?.destinationTeam === team.team;
          const n = team.players.length;
          const headerBg = alpha(colors.main, isDark ? 0.15 : 0.08);
          const headerColor = theme.palette.text.primary;
          const accentColor = colors.main;

          // Compute team average ELO if ratings are available
          const teamAvgElo = ratingsMap && n > 0
            ? Math.round(team.players.reduce((sum, p) => sum + (ratingsMap[p.name] ?? 1000), 0) / n)
            : null;

          return (
            <Paper
              key={team.team}
              data-testid="team-panel"
              data-team={team.team}
              data-motion={isMotionDestination ? "destination" : undefined}
              ref={(el: HTMLElement | null) => { zonesRef.current[team.team] = el; }}
              elevation={isActive ? 6 : 1}
              sx={{
                borderRadius: 3,
                overflow: "hidden",
                border: isActive
                  ? `2px solid ${colors.main}`
                  : drag
                    ? `2px dashed ${alpha(colors.main, 0.35)}`
                    : `1px solid ${theme.palette.divider}`,
                transition: "border-color 0.2s, box-shadow 0.2s",
              }}
            >
              {/* Team header */}
              <Box sx={{
                px: 2, py: 1.5,
                background: headerBg,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 1,
              }}>
                {editingTeam === teamIdx ? (
                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, flex: 1 }}>
                    <TextField
                      size="small"
                      value={editDraft}
                      autoFocus
                      onChange={(e) => setEditDraft(e.target.value.slice(0, 50))}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          const val = editDraft.trim() || team.team;
                          onTeamNameSave?.(teamIdx, val);
                          setEditingTeam(null);
                        }
                        if (e.key === "Escape") setEditingTeam(null);
                      }}
                      sx={{
                        flex: 1,
                        "& .MuiInputBase-root": { bgcolor: "background.paper", borderRadius: 1.5 },
                        "& .MuiInputBase-input": { py: 0.5, px: 1, fontSize: "0.9rem", fontWeight: 700 },
                      }}
                      slotProps={{
                        htmlInput: { maxLength: 50 }
                      }}
                    />
                    <IconButton size="small" onClick={() => {
                      const val = editDraft.trim() || team.team;
                      onTeamNameSave?.(teamIdx, val);
                      setEditingTeam(null);
                    }} sx={{ color: headerColor }}>
                      <CheckIcon fontSize="small" />
                    </IconButton>
                    <IconButton size="small" onClick={() => setEditingTeam(null)} sx={{ color: headerColor }}>
                      <CloseIcon fontSize="small" />
                    </IconButton>
                  </Box>
                ) : (
                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                    {onTeamNameSave && (
                      <IconButton
                        size="small"
                        onClick={() => { setEditDraft(team.team); setEditingTeam(teamIdx); }}
                        sx={{ color: headerColor, p: 0.5 }}
                      >
                        <EditIcon sx={{ fontSize: "1rem" }} />
                      </IconButton>
                    )}
                    <Typography variant="subtitle1" fontWeight={700} sx={{ color: headerColor }}>
                      {team.team}
                    </Typography>
                  </Box>
                )}
                <Stack direction="row" spacing={0.5} sx={{ flexShrink: 0 }}>
                  <Chip
                    label={n === 1 ? t("playerCount", { n }) : t("playerCountPlural", { n })}
                    size="small"
                    sx={{
                      bgcolor: alpha(accentColor, isDark ? 0.2 : 0.12),
                      color: headerColor,
                      fontWeight: 600,
                      fontSize: "0.75rem",
                    }}
                  />
                  {teamAvgElo !== null && (
                    <Chip
                      label={`Elo ${teamAvgElo}`}
                      size="small"
                      sx={{
                        bgcolor: alpha(accentColor, isDark ? 0.2 : 0.12),
                        color: headerColor,
                        fontWeight: 700,
                        fontSize: "0.75rem",
                      }}
                    />
                  )}
                </Stack>
              </Box>
              {/* Player list */}
              {n > 0 ? (
                <List dense disablePadding sx={{
                  py: 0.5,
                  bgcolor: isActive ? alpha(accentColor, 0.04) : "transparent",
                  transition: "background-color 0.15s",
                  animation: isShuffling
                    ? "team-player-shuffle 700ms cubic-bezier(0.22, 1, 0.36, 1) both"
                    : undefined,
                  animationDelay: isShuffling ? `${teamIdx * 55}ms` : undefined,
                }}>
                  {team.players.map((player, i) => {
                    const isBeingDragged = drag?.name === player.name && drag?.team === team.team;
                    const isArriving = playerMotion?.name === player.name && playerMotion.destinationTeam === team.team;
                    return (
                      <ListItem
                        key={player.name}
                        data-testid={`team-player-${player.name}`}
                        data-motion={isArriving ? "arriving" : undefined}
                        sx={{
                          userSelect: "none",
                          opacity: isBeingDragged ? 0.3 : 1,
                          animation: isArriving
                            ? "team-player-arrival 650ms cubic-bezier(0.22, 1, 0.36, 1) both"
                            : undefined,
                          transition: "opacity 0.15s, background-color 0.1s",
                          borderRadius: 2,
                          mx: 0.5,
                          px: 1.5,
                          "&:hover": {
                            bgcolor: alpha(accentColor, 0.06),
                          },
                        }}
                      >
                        <ListItemAvatar sx={{ minWidth: 40 }}>
                          <Avatar
                            sx={{
                              width: 28, height: 28,
                              fontSize: "0.8rem",
                              fontWeight: 700,
                              bgcolor: alpha(accentColor, isDark ? 0.2 : 0.12),
                              color: theme.palette.text.primary,
                            }}
                          >
                            {i + 1}
                          </Avatar>
                        </ListItemAvatar>
                        <ListItemText
                          primary={player.name}
                          secondary={ratingsMap ? `${Math.round(ratingsMap[player.name] ?? 1000)}` : undefined}
                          slotProps={{
                            primary: {
                              sx: { fontWeight: 500, fontSize: "0.9rem" },
                            },

                            secondary: {
                              sx: { fontSize: "0.75rem", fontWeight: 600, color: "text.secondary" },
                            }
                          }} />
                        <Box
                          data-testid={`team-player-handle-${player.name}`}
                          onPointerDown={(e) => handlePointerDown(e, player.name, team.team)}
                          sx={{
                            cursor: drag ? "grabbing" : "grab",
                            touchAction: "none",
                            display: "flex",
                            alignItems: "center",
                            p: 0.5,
                            borderRadius: 1,
                            "&:hover": {
                              bgcolor: alpha(theme.palette.text.primary, 0.08),
                            },
                          }}
                        >
                          <DragIndicatorIcon
                            fontSize="small"
                            sx={{ color: "text.disabled" }}
                          />
                        </Box>
                      </ListItem>
                    );
                  })}
                </List>
              ) : (
                <Box sx={{
                  py: 4, display: "flex", justifyContent: "center",
                  bgcolor: isActive ? alpha(accentColor, 0.04) : "transparent",
                }}>
                  <Typography variant="body2" color="text.disabled">
                    {t("dropPlayersHere")}
                  </Typography>
                </Box>
              )}
            </Paper>
          );
        })}
      </Box>
    </>
  );
}
