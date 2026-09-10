import React, { useState, useRef, useCallback, useEffect } from "react";
import { Box, Chip, useTheme } from "@mui/material";
import type { Imatch } from "~/lib/random";
import { movePlayer } from "~/lib/teams";

export const PLAYER_ARRIVAL_DURATION_MS = 650;
export const TEAM_SHUFFLE_DURATION_MS = 700;

/**
 * Shared keyframes for the team list/field motion (player arrival, shuffle
 * wobble) plus the reduced-motion escape hatch. Spread into the container sx.
 */
export const teamMotionKeyframes = {
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
};

export interface TeamDragState {
  name: string;
  team: string;
  ghostX: number;
  ghostY: number;
}

interface UseTeamDragOptions {
  matches: Imatch[];
  onResultChange: (matches: Imatch[]) => void;
  /** Increment when a server-side randomization starts to animate the reshuffle. */
  shuffleKey?: number;
}

/**
 * Pointer-drag state machine shared by the team list and field views. Owns the
 * drop-zone refs, the floating drag ghost, arrival/shuffle motion flags, and
 * commits player moves via {@link movePlayer}.
 */
export function useTeamDrag({ matches, onResultChange, shuffleKey = 0 }: UseTeamDragOptions) {
  const [drag, setDrag] = useState<TeamDragState | null>(null);
  const [activeDropZone, setActiveDropZone] = useState<string | null>(null);
  const [playerMotion, setPlayerMotion] = useState<{ name: string; destinationTeam: string } | null>(null);
  const [isShuffling, setIsShuffling] = useState(false);
  const previousShuffleKey = useRef<number | null>(null);
  const zonesRef = useRef<Record<string, HTMLElement | null>>({});

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

  const cancelDrag = useCallback(() => {
    setDrag(null);
    setActiveDropZone(null);
  }, []);

  const zoneAtPoint = useCallback((x: number, y: number): string | null => {
    for (const [zoneName, el] of Object.entries(zonesRef.current)) {
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        return zoneName;
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
    setActiveDropZone(zoneAtPoint(e.clientX, e.clientY));
  }, [drag, zoneAtPoint]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!drag) return;
    const destinationTeam = zoneAtPoint(e.clientX, e.clientY);
    const updated = destinationTeam
      ? movePlayer(matches, drag.name, drag.team, destinationTeam)
      : matches;
    if (updated !== matches && destinationTeam) {
      setPlayerMotion({ name: drag.name, destinationTeam });
      onResultChange(updated);
    }
    setDrag(null);
    setActiveDropZone(null);
  }, [drag, matches, zoneAtPoint, onResultChange]);

  useEffect(() => {
    if (!drag) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancelDrag();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drag, cancelDrag]);

  return {
    drag,
    activeDropZone,
    playerMotion,
    isShuffling,
    zonesRef,
    cancelDrag,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
  };
}

/** Floating chip that follows the pointer while a player is being dragged. */
export function TeamDragGhost({ drag }: { drag: TeamDragState | null }) {
  const theme = useTheme();
  if (!drag) return null;
  return (
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
  );
}
