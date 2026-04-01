import React, { useRef, useCallback, useState, useEffect } from "react";
import { Box, Typography, IconButton, useTheme } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import RemoveIcon from "@mui/icons-material/Remove";
import KeyboardArrowUpIcon from "@mui/icons-material/KeyboardArrowUp";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import { alpha } from "@mui/material";

interface ScoreRollerProps {
  value: string;
  onChange: (value: string) => void;
  teamName: string;
  min?: number;
  max?: number;
}

// A single animated digit slot
function DigitSlot({ digit, direction }: { digit: string; direction: "up" | "down" | null }) {
  const theme = useTheme();
  const [animKey, setAnimKey] = useState(0);
  const [prevDigit, setPrevDigit] = useState(digit);
  const [currentDigit, setCurrentDigit] = useState(digit);

  useEffect(() => {
    if (digit !== currentDigit) {
      setPrevDigit(currentDigit);
      setCurrentDigit(digit);
      setAnimKey((k) => k + 1);
    }
  }, [digit, currentDigit]);

  const exitAnim = direction === "up"
    ? "slideOutUp 0.18s ease-in forwards"
    : "slideOutDown 0.18s ease-in forwards";
  const enterAnim = direction === "up"
    ? "slideInUp 0.18s ease-out forwards"
    : "slideInDown 0.18s ease-out forwards";

  return (
    <Box
      sx={{
        width: { xs: 32, sm: 44 },
        height: { xs: 48, sm: 64 },
        borderRadius: { xs: 1.5, sm: 2 },
        backgroundColor: alpha(theme.palette.background.paper, 0.9),
        border: `1px solid ${alpha(theme.palette.divider, 0.2)}`,
        boxShadow: `0 2px 8px ${alpha(theme.palette.common.black, 0.12)}, inset 0 1px 0 ${alpha(theme.palette.common.white, 0.1)}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        position: "relative",
        // Slot machine groove lines
        "&::before, &::after": {
          content: '""',
          position: "absolute",
          left: 0,
          right: 0,
          height: "1px",
          backgroundColor: alpha(theme.palette.divider, 0.3),
          zIndex: 1,
        },
        "&::before": { top: "30%" },
        "&::after": { bottom: "30%" },
        "@keyframes slideOutUp": {
          from: { transform: "translateY(0)", opacity: 1 },
          to: { transform: "translateY(-100%)", opacity: 0 },
        },
        "@keyframes slideInUp": {
          from: { transform: "translateY(100%)", opacity: 0 },
          to: { transform: "translateY(0)", opacity: 1 },
        },
        "@keyframes slideOutDown": {
          from: { transform: "translateY(0)", opacity: 1 },
          to: { transform: "translateY(100%)", opacity: 0 },
        },
        "@keyframes slideInDown": {
          from: { transform: "translateY(-100%)", opacity: 0 },
          to: { transform: "translateY(0)", opacity: 1 },
        },
      }}
    >
      {/* Exiting digit */}
      {animKey > 0 && (
        <Typography
          key={`out-${animKey}`}
          sx={{
            position: "absolute",
            fontSize: { xs: "1.75rem", sm: "2.5rem" },
            fontWeight: 800,
            lineHeight: 1,
            fontVariantNumeric: "tabular-nums",
            animation: exitAnim,
          }}
        >
          {prevDigit}
        </Typography>
      )}
      {/* Entering digit */}
      <Typography
        key={`in-${animKey}`}
        sx={{
          position: "absolute",
          fontSize: { xs: "1.75rem", sm: "2.5rem" },
          fontWeight: 800,
          lineHeight: 1,
          fontVariantNumeric: "tabular-nums",
          animation: animKey > 0 ? enterAnim : "none",
        }}
      >
        {currentDigit}
      </Typography>
    </Box>
  );
}

export function ScoreRoller({ value, onChange, teamName, min = 0, max = 99 }: ScoreRollerProps) {
  const theme = useTheme();
  const isDragging = useRef(false);
  const dragStartY = useRef(0);
  const dragStartValue = useRef(0);
  const lastY = useRef(0);
  const [direction, setDirection] = useState<"up" | "down" | null>(null);
  const [isDraggingState, setIsDraggingState] = useState(false);

  const numValue = parseInt(value || "0", 10);
  const displayValue = String(numValue).padStart(2, "0");

  const changeValue = useCallback((newVal: number, dir: "up" | "down") => {
    const clamped = Math.max(min, Math.min(max, newVal));
    if (clamped !== parseInt(value || "0", 10)) {
      setDirection(dir);
      onChange(String(clamped));
    }
  }, [value, onChange, min, max]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    isDragging.current = true;
    dragStartY.current = e.clientY;
    dragStartValue.current = parseInt(value || "0", 10);
    lastY.current = e.clientY;
    setIsDraggingState(true);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [value]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging.current) return;
    const deltaY = lastY.current - e.clientY;
    lastY.current = e.clientY;
    if (Math.abs(deltaY) > 6) {
      // Drag UP = increase, drag DOWN = decrease (natural slot machine feel)
      const dir = deltaY > 0 ? "up" : "down";
      const step = deltaY > 0 ? 1 : -1;
      changeValue(parseInt(value || "0", 10) + step, dir);
    }
  }, [value, changeValue]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!isDragging.current) return;
    isDragging.current = false;
    setIsDraggingState(false);
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
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
          maxWidth: "100%",
          mb: 0.5,
        }}
      >
        {teamName}
      </Typography>

      {/* Up arrow hint */}
      <Box sx={{ display: "flex", justifyContent: "center", height: 20 }}>
        <KeyboardArrowUpIcon
          fontSize="small"
          sx={{
            color: isDraggingState ? "primary.main" : alpha(theme.palette.text.secondary, 0.4),
            transition: "color 0.2s",
          }}
        />
      </Box>

      <Box
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: { xs: 0.5, sm: 1 },
          py: { xs: 0.5, sm: 1 },
          px: { xs: 1, sm: 1.5 },
          borderRadius: { xs: 2, sm: 3 },
          backgroundColor: isDraggingState
            ? alpha(theme.palette.primary.main, 0.08)
            : alpha(theme.palette.action.hover, 0.5),
          cursor: isDraggingState ? "grabbing" : "grab",
          userSelect: "none",
          touchAction: "none",
          transition: "background-color 0.15s",
          border: `2px solid ${isDraggingState ? theme.palette.primary.main : "transparent"}`,
        }}
      >
        <IconButton
          size="small"
          onClick={() => changeValue(numValue - 1, "down")}
          onPointerDown={(e) => e.stopPropagation()}
          sx={{
            width: { xs: 36, sm: 32 },
            height: { xs: 36, sm: 32 },
            borderRadius: "50%",
            border: `1px solid ${alpha(theme.palette.divider, 0.3)}`,
            flexShrink: 0,
          }}
        >
          <RemoveIcon fontSize="small" />
        </IconButton>

        <Box sx={{ display: "flex", gap: { xs: 0.5, sm: 0.75 } }}>
          {displayValue.split("").map((digit, idx) => (
            <DigitSlot key={idx} digit={digit} direction={direction} />
          ))}
        </Box>

        <IconButton
          size="small"
          onClick={() => changeValue(numValue + 1, "up")}
          onPointerDown={(e) => e.stopPropagation()}
          sx={{
            width: { xs: 36, sm: 32 },
            height: { xs: 36, sm: 32 },
            borderRadius: "50%",
            border: `1px solid ${alpha(theme.palette.divider, 0.3)}`,
            flexShrink: 0,
          }}
        >
          <AddIcon fontSize="small" />
        </IconButton>
      </Box>

      {/* Down arrow hint */}
      <Box sx={{ display: "flex", justifyContent: "center", height: 20 }}>
        <KeyboardArrowDownIcon
          fontSize="small"
          sx={{
            color: isDraggingState ? "primary.main" : alpha(theme.palette.text.secondary, 0.4),
            transition: "color 0.2s",
          }}
        />
      </Box>
    </Box>
  );
}
