import React, { useRef, useCallback, useEffect, useState } from "react";
import { Box, Typography, useTheme } from "@mui/material";
import { alpha } from "@mui/material";

interface ScoreRollerProps {
  value: string;
  onChange: (value: string) => void;
  teamName: string;
  min?: number;
  max?: number;
}

const ITEM_HEIGHT = 52;
const VISIBLE_ITEMS = 5; // must be odd
const WHEEL_HEIGHT = ITEM_HEIGHT * VISIBLE_ITEMS;

export function ScoreRoller({ value, onChange, teamName, min = 0, max = 20 }: ScoreRollerProps) {
  const theme = useTheme();
  const numValue = Math.max(min, Math.min(max, parseInt(value || "0", 10)));
  const items = Array.from({ length: max - min + 1 }, (_, i) => i + min);

  const listRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const startYRef = useRef(0);
  const startScrollTopRef = useRef(0);
  const lastYRef = useRef(0);
  const lastTimeRef = useRef(0);
  const velocityRef = useRef(0);
  const rafIdRef = useRef<number | null>(null);
  const [isDraggingState, setIsDraggingState] = useState(false);

  // Scroll to value without animation on mount
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = (numValue - min) * ITEM_HEIGHT;
  }, []); // only on mount

  // Scroll to value with animation when value changes externally
  const prevValueRef = useRef(numValue);
  useEffect(() => {
    if (prevValueRef.current === numValue) return;
    prevValueRef.current = numValue;
    const el = listRef.current;
    if (!el || isDraggingRef.current) return;
    el.scrollTo({ top: (numValue - min) * ITEM_HEIGHT, behavior: "smooth" });
  }, [numValue, min]);

  const snapToNearest = useCallback((el: HTMLDivElement) => {
    const rawIndex = el.scrollTop / ITEM_HEIGHT;
    const index = Math.round(rawIndex);
    const clamped = Math.max(0, Math.min(items.length - 1, index));
    const newValue = items[clamped];
    el.scrollTo({ top: clamped * ITEM_HEIGHT, behavior: "smooth" });
    if (newValue !== parseInt(value || "0", 10)) {
      onChange(String(newValue));
    }
  }, [items, value, onChange]);

  const applyMomentum = useCallback((el: HTMLDivElement) => {
    if (Math.abs(velocityRef.current) < 0.5) {
      snapToNearest(el);
      return;
    }
    el.scrollTop += velocityRef.current;
    velocityRef.current *= 0.92;
    rafIdRef.current = requestAnimationFrame(() => applyMomentum(el));
  }, [snapToNearest]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    const el = listRef.current;
    if (!el) return;
    e.preventDefault();
    if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
    isDraggingRef.current = true;
    setIsDraggingState(true);
    startYRef.current = e.clientY;
    startScrollTopRef.current = el.scrollTop;
    lastYRef.current = e.clientY;
    lastTimeRef.current = Date.now();
    velocityRef.current = 0;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDraggingRef.current) return;
    const el = listRef.current;
    if (!el) return;
    const now = Date.now();
    const dt = now - lastTimeRef.current;
    const dy = lastYRef.current - e.clientY;
    if (dt > 0) velocityRef.current = dy / dt * 16; // normalize to ~60fps
    lastYRef.current = e.clientY;
    lastTimeRef.current = now;
    el.scrollTop = startScrollTopRef.current + (startYRef.current - e.clientY);
  }, []);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    setIsDraggingState(false);
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    const el = listRef.current;
    if (!el) return;
    if (Math.abs(velocityRef.current) > 1) {
      rafIdRef.current = requestAnimationFrame(() => applyMomentum(el));
    } else {
      snapToNearest(el);
    }
  }, [applyMomentum, snapToNearest]);

  // Snap on scroll end (for mouse wheel / keyboard)
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleScroll = useCallback(() => {
    if (isDraggingRef.current) return;
    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    scrollTimeoutRef.current = setTimeout(() => {
      const el = listRef.current;
      if (el) snapToNearest(el);
    }, 80);
  }, [snapToNearest]);

  // Block mouse wheel / trackpad scroll from changing the score.
  // On non-touch devices the score should only change via click-and-drag.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const blockWheel = (e: WheelEvent) => {
      e.preventDefault();
    };
    el.addEventListener("wheel", blockWheel, { passive: false });
    return () => el.removeEventListener("wheel", blockWheel);
  }, []);

  useEffect(() => {
    return () => {
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    };
  }, []);

  return (
    <Box sx={{ textAlign: "center", flex: 1, minWidth: 0 }}>
      <Typography
        variant="caption"
        fontWeight={600}
        color="text.secondary"
        sx={{
          display: "block",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          mb: 1,
        }}
      >
        {teamName}
      </Typography>

      <Box
        sx={{
          position: "relative",
          height: WHEEL_HEIGHT,
          borderRadius: 3,
          overflow: "hidden",
          border: `2px solid ${isDraggingState ? theme.palette.primary.main : alpha(theme.palette.divider, 0.3)}`,
          transition: "border-color 0.15s",
          backgroundColor: alpha(theme.palette.background.paper, 0.6),
          cursor: isDraggingState ? "grabbing" : "grab",
          userSelect: "none",
          touchAction: "none",
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {/* Scrollable list */}
        <Box
          ref={listRef}
          onScroll={handleScroll}
          sx={{
            height: "100%",
            overflowY: "scroll",
            scrollbarWidth: "none",
            "&::-webkit-scrollbar": { display: "none" },
            // Padding so first/last items can center
            "&::before": {
              content: '""',
              display: "block",
              height: ITEM_HEIGHT * Math.floor(VISIBLE_ITEMS / 2),
            },
            "&::after": {
              content: '""',
              display: "block",
              height: ITEM_HEIGHT * Math.floor(VISIBLE_ITEMS / 2),
            },
          }}
        >
          {items.map((item) => {
            const isSelected = item === numValue;
            return (
              <Box
                key={item}
                sx={{
                  height: ITEM_HEIGHT,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  transition: "transform 0.1s",
                }}
              >
                <Typography
                  sx={{
                    fontSize: isSelected ? "2.25rem" : "1.25rem",
                    fontWeight: isSelected ? 800 : 400,
                    color: isSelected ? "text.primary" : alpha(theme.palette.text.primary, 0.3),
                    fontVariantNumeric: "tabular-nums",
                    lineHeight: 1,
                    transition: "font-size 0.15s, font-weight 0.15s, color 0.15s",
                    pointerEvents: "none",
                  }}
                >
                  {String(item).padStart(2, "0")}
                </Typography>
              </Box>
            );
          })}
        </Box>

        {/* Selection highlight */}
        <Box
          sx={{
            position: "absolute",
            top: "50%",
            left: 0,
            right: 0,
            height: ITEM_HEIGHT,
            transform: "translateY(-50%)",
            backgroundColor: alpha(theme.palette.primary.main, 0.08),
            borderTop: `1px solid ${alpha(theme.palette.primary.main, 0.25)}`,
            borderBottom: `1px solid ${alpha(theme.palette.primary.main, 0.25)}`,
            pointerEvents: "none",
          }}
        />

        {/* Top fade */}
        <Box
          sx={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: ITEM_HEIGHT * Math.floor(VISIBLE_ITEMS / 2),
            background: `linear-gradient(to bottom, ${theme.palette.background.paper}, ${alpha(theme.palette.background.paper, 0)})`,
            pointerEvents: "none",
          }}
        />

        {/* Bottom fade */}
        <Box
          sx={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            height: ITEM_HEIGHT * Math.floor(VISIBLE_ITEMS / 2),
            background: `linear-gradient(to top, ${theme.palette.background.paper}, ${alpha(theme.palette.background.paper, 0)})`,
            pointerEvents: "none",
          }}
        />
      </Box>
    </Box>
  );
}
