import React, { useState, useRef, useCallback, useEffect } from "react";
import { Box, Chip, Grid2, Paper, Typography, Divider, alpha, useTheme } from "@mui/material";
import type { Imatch } from "~/lib/random";
import { useT } from "~/lib/useT";

interface Props {
  matches: Imatch[];
  onResultChange: (matches: Imatch[]) => void;
}

interface DragState {
  name: string;
  team: string;
  ghostX: number;
  ghostY: number;
}

export function TeamPicker({ matches, onResultChange }: Props) {
  const theme = useTheme();
  const t = useT();
  const [drag, setDrag] = useState<DragState | null>(null);
  const [activeDropZone, setActiveDropZone] = useState<string | null>(null);
  const teamRefs = useRef<Record<string, HTMLElement | null>>({});

  // Find which team zone the pointer is currently over
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
    // Only primary button / first touch
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

  // Cancel on Escape
  useEffect(() => {
    if (!drag) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setDrag(null); setActiveDropZone(null); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drag]);

  return (
    <>
      {/* Floating ghost chip while dragging */}
      {drag && (
        <Box sx={{
          position: "fixed",
          left: drag.ghostX,
          top: drag.ghostY,
          transform: "translate(-50%, -50%)",
          pointerEvents: "none",
          zIndex: 9999,
          opacity: 0.85,
          rotate: "4deg",
        }}>
          <Chip label={drag.name} color="primary" sx={{ fontWeight: 600, boxShadow: 4 }} />
        </Box>
      )}

      <Grid2
        container spacing={3} justifyContent="center"
        onPointerMove={drag ? handlePointerMove : undefined}
        onPointerUp={drag ? handlePointerUp : undefined}
        onPointerCancel={() => { setDrag(null); setActiveDropZone(null); }}
      >
        {matches.map((team) => {
          const isActive = activeDropZone === team.team;
          const n = team.players.length;
          return (
            <Grid2 key={team.team} size={{ xs: 12, sm: 6 }}>
              <Paper elevation={3} sx={{
                borderRadius: 2, overflow: "hidden",
                border: isActive
                  ? `2px solid ${theme.palette.primary.main}`
                  : drag
                    ? `2px dashed ${alpha(theme.palette.primary.main, 0.3)}`
                    : "2px solid transparent",
                transition: "border-color 0.15s, background-color 0.15s",
              }}>
                <Box sx={{ px: 3, pt: 2, pb: 1 }}>
                  <Typography variant="h5" fontWeight={700}>{team.team}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {n === 1 ? t("playerCount", { n }) : t("playerCountPlural", { n })}
                  </Typography>
                </Box>
                <Divider />
                <Box
                  ref={(el: HTMLElement | null) => { teamRefs.current[team.team] = el; }}
                  sx={{
                    minHeight: 80, p: 2, display: "flex", flexWrap: "wrap", gap: 1,
                    backgroundColor: isActive ? alpha(theme.palette.primary.main, 0.08) : "transparent",
                    transition: "background-color 0.15s",
                    touchAction: "none", // prevent scroll interference during drag
                  }}
                >
                  {team.players.map((player) => {
                    const isBeingDragged = drag?.name === player.name && drag?.team === team.team;
                    return (
                      <Box
                        key={player.name}
                        onPointerDown={(e) => handlePointerDown(e, player.name, team.team)}
                        sx={{ cursor: drag ? "grabbing" : "grab", userSelect: "none", touchAction: "none" }}
                      >
                        <Chip
                          label={player.name}
                          sx={{
                            fontWeight: 500,
                            opacity: isBeingDragged ? 0.3 : 1,
                            transition: "opacity 0.15s",
                            pointerEvents: "none",
                          }}
                        />
                      </Box>
                    );
                  })}
                  {n === 0 && (
                    <Typography variant="body2" color="text.disabled" sx={{ m: "auto" }}>
                      {t("dropPlayersHere")}
                    </Typography>
                  )}
                </Box>
              </Paper>
            </Grid2>
          );
        })}
      </Grid2>
    </>
  );
}
