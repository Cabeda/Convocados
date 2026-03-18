import React, { useState, useRef, useCallback, useEffect } from "react";
import {
  Box, Chip, Paper, Typography, alpha, useTheme, Stack, Avatar,
  List, ListItem, ListItemAvatar, ListItemText, IconButton, TextField, Tooltip,
} from "@mui/material";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import EditIcon from "@mui/icons-material/Edit";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import type { Imatch } from "~/lib/random";
import { useT } from "~/lib/useT";

interface Props {
  matches: Imatch[];
  onResultChange: (matches: Imatch[]) => void;
  onTeamNameSave?: (teamIndex: number, newName: string) => void;
  ratingsMap?: Record<string, number>;
}

interface DragState {
  name: string;
  team: string;
  ghostX: number;
  ghostY: number;
}

export function TeamPicker({ matches, onResultChange, onTeamNameSave, ratingsMap }: Props) {
  const theme = useTheme();
  const t = useT();
  const isDark = theme.palette.mode === "dark";

  const TEAM_COLORS = [
    theme.palette.primary,
    theme.palette.secondary,
  ];

  const [drag, setDrag] = useState<DragState | null>(null);
  const [activeDropZone, setActiveDropZone] = useState<string | null>(null);
  const [editingTeam, setEditingTeam] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const teamRefs = useRef<Record<string, HTMLElement | null>>({});

  const teamAtPoint = useCallback((x: number, y: number): string | null => {
    for (const [teamName, el] of Object.entries(teamRefs.current)) {
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        return teamName;
      }
    }
    return null;
  }, []);

  const commitMove = useCallback((destinationTeam: string | null, sourceName: string, sourceTeam: string) => {
    if (!destinationTeam || destinationTeam === sourceTeam) return;
    const updated = matches.map((match) => {
      if (match.team === sourceTeam) {
        return { ...match, players: match.players.filter((p) => p.name !== sourceName) };
      }
      if (match.team === destinationTeam) {
        const newPlayers = [...match.players, { name: sourceName, order: match.players.length }].map(
          (p, i) => ({ ...p, order: i })
        );
        return { ...match, players: newPlayers };
      }
      return match;
    });
    onResultChange(updated);
  }, [matches, onResultChange]);

  const handlePointerDown = useCallback((e: React.PointerEvent, playerName: string, teamName: string) => {
    if (e.button !== undefined && e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
    setDrag({ name: playerName, team: teamName, ghostX: e.clientX, ghostY: e.clientY });
    setActiveDropZone(null);
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!drag) return;
    e.preventDefault();
    setDrag((d) => d ? { ...d, ghostX: e.clientX, ghostY: e.clientY } : null);
    setActiveDropZone(teamAtPoint(e.clientX, e.clientY));
  }, [drag, teamAtPoint]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!drag) return;
    const dest = teamAtPoint(e.clientX, e.clientY);
    commitMove(dest, drag.name, drag.team);
    setDrag(null);
    setActiveDropZone(null);
  }, [drag, teamAtPoint, commitMove]);

  useEffect(() => {
    if (!drag) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setDrag(null); setActiveDropZone(null); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drag]);

  return (
    <>
      {drag && (
        <Box sx={{
          position: "fixed",
          left: drag.ghostX,
          top: drag.ghostY,
          transform: "translate(-50%, -50%)",
          pointerEvents: "none",
          zIndex: 9999,
        }}>
          <Chip
            label={drag.name}
            sx={{
              fontWeight: 600,
              boxShadow: 6,
              bgcolor: theme.palette.primary.main,
              color: theme.palette.primary.contrastText,
              transform: "scale(1.1) rotate(3deg)",
            }}
          />
        </Box>
      )}

      <Stack
        spacing={2}
        onPointerMove={drag ? handlePointerMove : undefined}
        onPointerUp={drag ? handlePointerUp : undefined}
        onPointerCancel={() => { setDrag(null); setActiveDropZone(null); }}
      >
        {matches.map((team, teamIdx) => {
          const colors = TEAM_COLORS[teamIdx % TEAM_COLORS.length];
          const isActive = activeDropZone === team.team;
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
              ref={(el: HTMLElement | null) => { teamRefs.current[team.team] = el; }}
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
                      inputProps={{ maxLength: 50 }}
                      sx={{
                        flex: 1,
                        "& .MuiInputBase-root": { bgcolor: "background.paper", borderRadius: 1.5 },
                        "& .MuiInputBase-input": { py: 0.5, px: 1, fontSize: "0.9rem", fontWeight: 700 },
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
                }}>
                  {team.players.map((player, i) => {
                    const isBeingDragged = drag?.name === player.name && drag?.team === team.team;
                    return (
                      <ListItem
                        key={player.name}
                        sx={{
                          userSelect: "none",
                          opacity: isBeingDragged ? 0.3 : 1,
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
                          primaryTypographyProps={{
                            fontWeight: 500,
                            fontSize: "0.9rem",
                          }}
                          secondaryTypographyProps={{
                            fontSize: "0.75rem",
                            fontWeight: 600,
                            color: "text.secondary",
                          }}
                        />
                        <Box
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
      </Stack>
    </>
  );
}
