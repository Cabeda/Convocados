import React, { useRef, useCallback } from "react";
import { Box, Typography, IconButton, useTheme } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import RemoveIcon from "@mui/icons-material/Remove";
import { alpha } from "@mui/material";

interface ScoreRollerProps {
  value: string;
  onChange: (value: string) => void;
  teamName: string;
  min?: number;
  max?: number;
}

export function ScoreRoller({ value, onChange, teamName, min = 0, max = 99 }: ScoreRollerProps) {
  const theme = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const dragStartY = useRef(0);
  const dragStartValue = useRef(0);
  const lastY = useRef(0);

  const numValue = parseInt(value || "0", 10);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    isDragging.current = true;
    dragStartY.current = e.clientY;
    dragStartValue.current = numValue;
    lastY.current = e.clientY;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [numValue]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging.current) return;
    const deltaY = lastY.current - e.clientY;
    lastY.current = e.clientY;
    if (Math.abs(deltaY) > 5) {
      const step = deltaY > 0 ? -1 : 1;
      const newValue = Math.max(min, Math.min(max, numValue + step));
      if (newValue !== numValue) {
        onChange(String(newValue));
      }
    }
  }, [numValue, onChange, min, max]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!isDragging.current) return;
    isDragging.current = false;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  }, []);

  const handleClick = (delta: number) => {
    const newValue = Math.max(min, Math.min(max, numValue + delta));
    if (newValue !== numValue) {
      onChange(String(newValue));
    }
  };

  const displayValue = String(numValue).padStart(2, "0");

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
        }}
      >
        {teamName}
      </Typography>
      
      <Box
        ref={containerRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: { xs: 0.5, sm: 1 },
          mt: 1,
          py: { xs: 1, sm: 1.5 },
          px: { xs: 1, sm: 2 },
          borderRadius: { xs: 2, sm: 3 },
          backgroundColor: "action.hover",
          cursor: "grab",
          userSelect: "none",
          touchAction: "none",
          transition: "background-color 0.2s",
          "&:active": {
            cursor: "grabbing",
            backgroundColor: "action.selected",
          },
        }}
      >
        <IconButton
          size="small"
          onClick={() => handleClick(-1)}
          onPointerDown={(e) => e.stopPropagation()}
          sx={{
            minWidth: { xs: 40, sm: 36 },
            height: { xs: 40, sm: 36 },
            borderRadius: "50%",
            backgroundColor: "surface-container-low",
            "&:hover": {
              backgroundColor: "surface-container-high",
            },
          }}
        >
          <RemoveIcon fontSize="small" />
        </IconButton>

        <Box
          sx={{
            display: "flex",
            gap: { xs: 0.25, sm: 0.5 },
            px: { xs: 0.5, sm: 1 },
          }}
        >
          {displayValue.split("").map((digit, idx) => (
            <Box
              key={idx}
              sx={{
                width: { xs: 28, sm: 40 },
                height: { xs: 44, sm: 56 },
                borderRadius: { xs: 1, sm: 2 },
                backgroundColor: "surface-container-highest",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: 1,
              }}
            >
              <Typography
                sx={{
                  fontSize: { xs: "1.5rem", sm: "2.25rem" },
                  fontWeight: 700,
                  lineHeight: 1,
                  color: "on-surface",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {digit}
              </Typography>
            </Box>
          ))}
        </Box>

        <IconButton
          size="small"
          onClick={() => handleClick(1)}
          onPointerDown={(e) => e.stopPropagation()}
          sx={{
            minWidth: { xs: 40, sm: 36 },
            height: { xs: 40, sm: 36 },
            borderRadius: "50%",
            backgroundColor: "surface-container-low",
            "&:hover": {
              backgroundColor: "surface-container-high",
            },
          }}
        >
          <AddIcon fontSize="small" />
        </IconButton>
      </Box>
    </Box>
  );
}
