import React, { useState, useRef, useCallback, useEffect } from "react";
import {
  Box, Chip, Typography, alpha, useTheme, Stack, Avatar,
} from "@mui/material";
import type { Imatch } from "~/lib/random";
import { movePlayer } from "~/lib/teams";
import { useT } from "~/lib/useT";

interface Props {
  matches: Imatch[];
  onResultChange: (matches: Imatch[]) => void;
  ratingsMap?: Record<string, number>;
  /** Increment when a server-side randomization starts to animate the reshuffle. */
  shuffleKey?: number;
}

interface DragState {
  name: string;
  team: string;
  ghostX: number;
  ghostY: number;
}

const PLAYER_ARRIVAL_DURATION_MS = 650;
const TEAM_SHUFFLE_DURATION_MS = 700;

/**
 * Field view of the randomized teams. Two halves of a sport pitch, one per
 * team, with players rendered as draggable tokens. Dragging a token onto the
 * other half moves that player between teams.
 */
export function TeamField({
  matches,
  onResultChange,
  ratingsMap,
  shuffleKey = 0,
}: Props) {
  const theme = useTheme();
  const t = useT();
  const isDark = theme.palette.mode === "dark";

  const TEAM_COLORS = [theme.palette.primary, theme.palette.secondary];

  const [drag, setDrag] = useState<DragState | null>(null);
  const [activeDropZone, setActiveDropZone] = useState<string | null>(null);
  const [playerMotion, setPlayerMotion] = useState<{ name: string; destinationTeam: string } | null>(null);
  const [isShuffling, setIsShuffling] = useState(false);
  const previousShuffleKey = useRef<number | null>(null);
  const halvesRef = useRef<Record<string, HTMLElement | null>>({});

  useEffect(() => {
    if (!playerMotion) return;
    const timer = window.setTimeout(() => setPlayerMotion(null), PLAYER_ARRIVAL_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [playerMotion]);

  useEffect(() => {
    const isFirstRender = previousShuffleKey.current === null;
    const changed = previousShuffleKey.current !== shuffleKey;
    previousShuffleKey.current = shuffleKey;
    if (!changed || (isFirstRender && shuffleKey === 0)) return;

    setIsShuffling(true);
    const timer = window.setTimeout(() => setIsShuffling(false), TEAM_SHUFFLE_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [shuffleKey]);

  const teamAtPoint = useCallback((x: number, y: number): string | null => {
    for (const [teamName, el] of Object.entries(halvesRef.current)) {
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        return teamName;
      }
    }
    return null;
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent, playerName: string, teamName: string) => {
    if (e.button !== undefined && e.button !== 0) return;
    if (typeof e.currentTarget.setPointerCapture === "function") {
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    e.preventDefault();
    setDrag({ name: playerName, team: teamName, ghostX: e.clientX, ghostY: e.clientY });
    setActiveDropZone(null);
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!drag) return;
    e.preventDefault();
    setDrag((d) => (d ? { ...d, ghostX: e.clientX, ghostY: e.clientY } : null));
    setActiveDropZone(teamAtPoint(e.clientX, e.clientY));
  }, [drag, teamAtPoint]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!drag) return;
    const destinationTeam = teamAtPoint(e.clientX, e.clientY);
    const updated = destinationTeam
      ? movePlayer(matches, drag.name, drag.team, destinationTeam)
      : matches;
    if (updated !== matches) {
      setPlayerMotion({ name: drag.name, destinationTeam: destinationTeam! });
      onResultChange(updated);
    }
    setDrag(null);
    setActiveDropZone(null);
  }, [drag, matches, teamAtPoint, onResultChange]);

  useEffect(() => {
    if (!drag) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDrag(null);
        setActiveDropZone(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drag]);

  return (
    <>
      {drag && (
        <Box
          sx={{
            position: "fixed",
            left: drag.ghostX,
            top: drag.ghostY,
            transform: "translate(-50%, -50%)",
            pointerEvents: "none",
            zIndex: 9999,
          }}
        >
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
      <Box
        data-testid="team-field"
        data-shuffling={isShuffling ? "true" : "false"}
        data-dragging={drag ? "true" : "false"}
        data-shuffle-key={shuffleKey}
        sx={{
          position: "relative",
          display: "grid",
          gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
          gap: { xs: 1, sm: 1.5 },
          p: { xs: 1, sm: 1.5 },
          borderRadius: 3,
          overflow: "hidden",
          background: isDark
            ? "linear-gradient(160deg, #14361f 0%, #0f2a19 100%)"
            : "linear-gradient(160deg, #2f8f4e 0%, #246f3d 100%)",
          border: `1px solid ${alpha(theme.palette.common.black, 0.25)}`,
          // Center line between the two halves
          "&::before": {
            content: '""',
            position: "absolute",
            top: "4%",
            bottom: "4%",
            left: "50%",
            width: 2,
            bgcolor: alpha("#ffffff", 0.35),
            display: { xs: "none", sm: "block" },
          },
          // Center circle
          "&::after": {
            content: '""',
            position: "absolute",
            top: "50%",
            left: "50%",
            width: 72,
            height: 72,
            borderRadius: "50%",
            border: `2px solid ${alpha("#ffffff", 0.35)}`,
            transform: "translate(-50%, -50%)",
            display: { xs: "none", sm: "block" },
            pointerEvents: "none",
          },
          "@keyframes team-player-arrival": {
            "0%": { opacity: 0, transform: "translateY(-18px) scale(0.92) rotate(-2deg)" },
            "65%": { opacity: 1, transform: "translateY(3px) scale(1.015) rotate(0.5deg)" },
            "100%": { opacity: 1, transform: "translateY(0) scale(1) rotate(0)" },
          },
          "@keyframes team-player-shuffle": {
            "0%": { transform: "translateX(0) rotate(0)" },
            "30%": { transform: "translateX(-8px) rotate(-1deg)" },
            "60%": { transform: "translateX(8px) rotate(1deg)" },
            "100%": { transform: "translateX(0) rotate(0)" },
          },
          "@media (prefers-reduced-motion: reduce)": {
            "& *": { animationDuration: "1ms !important", transitionDuration: "1ms !important" },
          },
        }}
        onPointerMove={drag ? handlePointerMove : undefined}
        onPointerUp={drag ? handlePointerUp : undefined}
        onPointerCancel={() => {
          setDrag(null);
          setActiveDropZone(null);
        }}
      >
        {matches.map((team, teamIdx) => {
          const colors = TEAM_COLORS[teamIdx % TEAM_COLORS.length];
          const isActive = activeDropZone === team.team;
          const n = team.players.length;
          const accentColor = colors.main;
          const teamAvgElo = ratingsMap && n > 0
            ? Math.round(team.players.reduce((sum, p) => sum + (ratingsMap[p.name] ?? 1000), 0) / n)
            : null;

          return (
            <Box
              key={team.team}
              data-testid="field-half"
              data-team={team.team}
              ref={(el: HTMLElement | null) => { halvesRef.current[team.team] = el; }}
              sx={{
                position: "relative",
                zIndex: 1,
                display: "flex",
                flexDirection: "column",
                gap: 1,
                p: { xs: 1, sm: 1.5 },
                borderRadius: 2,
                border: isActive
                  ? `2px solid #ffffff`
                  : drag
                    ? `2px dashed ${alpha("#ffffff", 0.4)}`
                    : `2px solid ${alpha("#ffffff", 0.15)}`,
                bgcolor: isActive ? alpha("#ffffff", 0.18) : alpha("#ffffff", 0.06),
                transition: "border-color 0.2s, background-color 0.2s",
              }}
            >
              <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", justifyContent: "space-between" }}>
                <Typography
                  variant="subtitle1"
                  fontWeight={700}
                  sx={{ color: "#ffffff", textShadow: "0 1px 2px rgba(0,0,0,0.35)" }}
                >
                  {team.team}
                </Typography>
                <Stack direction="row" spacing={0.5}>
                  <Chip
                    label={n === 1 ? t("playerCount", { n }) : t("playerCountPlural", { n })}
                    size="small"
                    sx={{
                      bgcolor: alpha("#ffffff", 0.22),
                      color: "#ffffff",
                      fontWeight: 600,
                      fontSize: "0.72rem",
                    }}
                  />
                  {teamAvgElo !== null && (
                    <Chip
                      data-testid={`field-half-elo-${team.team}`}
                      label={`Elo ${teamAvgElo}`}
                      size="small"
                      sx={{
                        bgcolor: alpha("#ffffff", 0.22),
                        color: "#ffffff",
                        fontWeight: 700,
                        fontSize: "0.72rem",
                      }}
                    />
                  )}
                </Stack>
              </Stack>

              {n > 0 ? (
                <Box
                  sx={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignContent: "flex-start",
                    gap: 1,
                    minHeight: 88,
                    animation: isShuffling
                      ? "team-player-shuffle 700ms cubic-bezier(0.22, 1, 0.36, 1) both"
                      : undefined,
                    animationDelay: isShuffling ? `${teamIdx * 55}ms` : undefined,
                  }}
                >
                  {team.players.map((player, i) => {
                    const isBeingDragged = drag?.name === player.name && drag?.team === team.team;
                    const isArriving = playerMotion?.name === player.name
                      && playerMotion.destinationTeam === team.team;
                    return (
                      <Box
                        key={player.name}
                        data-testid={`field-player-${player.name}`}
                        data-motion={isArriving ? "arriving" : undefined}
                        onPointerDown={(e) => handlePointerDown(e, player.name, team.team)}
                        sx={{
                          display: "flex",
                          alignItems: "center",
                          gap: 0.75,
                          pl: 0.5,
                          pr: 1.25,
                          py: 0.5,
                          borderRadius: 5,
                          bgcolor: alpha("#ffffff", 0.92),
                          boxShadow: 2,
                          cursor: drag ? "grabbing" : "grab",
                          touchAction: "none",
                          userSelect: "none",
                          opacity: isBeingDragged ? 0.3 : 1,
                          transition: "opacity 0.15s, transform 0.15s, box-shadow 0.15s",
                          "&:hover": { transform: "translateY(-1px)", boxShadow: 4 },
                          animation: isArriving
                            ? "team-player-arrival 650ms cubic-bezier(0.22, 1, 0.36, 1) both"
                            : undefined,
                        }}
                      >
                        <Avatar
                          sx={{
                            width: 22,
                            height: 22,
                            fontSize: "0.7rem",
                            fontWeight: 700,
                            bgcolor: alpha(accentColor, isDark ? 0.3 : 0.18),
                            color: isDark ? "#ffffff" : theme.palette.text.primary,
                          }}
                        >
                          {i + 1}
                        </Avatar>
                        <Typography variant="body2" fontWeight={600} sx={{ fontSize: "0.82rem" }}>
                          {player.name}
                        </Typography>
                        {ratingsMap && (
                          <Typography variant="caption" sx={{ color: "text.secondary", fontWeight: 700 }}>
                            {Math.round(ratingsMap[player.name] ?? 1000)}
                          </Typography>
                        )}
                      </Box>
                    );
                  })}
                </Box>
              ) : (
                <Box sx={{ py: 3, display: "flex", justifyContent: "center" }}>
                  <Typography variant="body2" sx={{ color: alpha("#ffffff", 0.7) }}>
                    {t("dropPlayersHere")}
                  </Typography>
                </Box>
              )}
            </Box>
          );
        })}
      </Box>
    </>
  );
}
