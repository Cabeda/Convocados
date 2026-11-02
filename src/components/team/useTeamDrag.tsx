import React, { useState, useRef, useCallback, useEffect } from "react";
import { Box, Chip, useTheme } from "@mui/material";
import type { Imatch } from "~/lib/random";
import { movePlayer } from "~/lib/teams";

export const PLAYER_ARRIVAL_DURATION_MS = 650;
export const TEAM_SHUFFLE_DURATION_MS = 700;
/** Movement below this many pixels counts as a tap, not a drag. */
const TAP_MOVE_THRESHOLD_PX = 6;

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
  /**
   * Custom drop resolution. When provided, the hook delegates the move to it
   * and skips its default zone + movePlayer logic. Return null for a no-op.
   */
  resolveMove?: (
    drag: TeamDragState,
    x: number,
    y: number,
  ) => { updated: Imatch[]; destinationTeam: string } | null;
  /**
   * Called instead of a drop when a press ends without travelling past the tap
   * threshold. Lets a view offer one-tap moves without losing its drag.
   */
  onTap?: (drag: TeamDragState) => void;
}

/**
 * Pointer-drag state machine shared by the team list and field views. Owns the
 * drop-zone refs, the floating drag ghost, arrival/shuffle motion flags, and
 * commits player moves via {@link movePlayer}.
 */
export function useTeamDrag({ matches, onResultChange, shuffleKey = 0, resolveMove, onTap }: UseTeamDragOptions) {
  const [drag, setDrag] = useState<TeamDragState | null>(null);
  const [activeDropZone, setActiveDropZone] = useState<string | null>(null);
  const [playerMotion, setPlayerMotion] = useState<{ name: string; destinationTeam: string } | null>(null);
  const [isShuffling, setIsShuffling] = useState(false);
  const previousShuffleKey = useRef<number | null>(null);
  const zonesRef = useRef<Record<string, HTMLElement | null>>({});
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const dragMovedRef = useRef(false);

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
    dragStartRef.current = null;
    dragMovedRef.current = false;
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
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    dragMovedRef.current = false;
    setDrag({ name: playerName, team: teamName, ghostX: e.clientX, ghostY: e.clientY });
    setActiveDropZone(null);
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!drag) return;
    e.preventDefault();
    const start = dragStartRef.current;
    if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) >= TAP_MOVE_THRESHOLD_PX) {
      dragMovedRef.current = true;
    }
    setDrag((d) => (d ? { ...d, ghostX: e.clientX, ghostY: e.clientY } : null));
    setActiveDropZone(zoneAtPoint(e.clientX, e.clientY));
  }, [drag, zoneAtPoint]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!drag) return;

    const start = dragStartRef.current;
    const travelled = start ? Math.hypot(e.clientX - start.x, e.clientY - start.y) : Infinity;
    const isTap = !dragMovedRef.current && travelled < TAP_MOVE_THRESHOLD_PX;

    if (onTap && isTap) {
      onTap(drag);
      cancelDrag();
      return;
    }

    if (resolveMove) {
      const resolved = resolveMove(drag, e.clientX, e.clientY);
      if (resolved) {
        setPlayerMotion({ name: drag.name, destinationTeam: resolved.destinationTeam });
        onResultChange(resolved.updated);
      }
      cancelDrag();
      return;
    }

    const destinationTeam = zoneAtPoint(e.clientX, e.clientY);
    const updated = destinationTeam
      ? movePlayer(matches, drag.name, drag.team, destinationTeam)
      : matches;
    if (updated !== matches && destinationTeam) {
      setPlayerMotion({ name: drag.name, destinationTeam });
      onResultChange(updated);
    }
    cancelDrag();
  }, [drag, matches, zoneAtPoint, onResultChange, resolveMove, onTap, cancelDrag]);

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
    zoneAtPoint,
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
