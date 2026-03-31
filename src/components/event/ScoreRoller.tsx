import React, { useRef, useState, useCallback } from "react";
import { Box, Typography, IconButton } from "@mui/material";
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
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartY = useRef(0);
  const dragStartValue = useRef(0);
  const velocityRef = useRef(0);
  const lastYRef = useRef(0);
  const animationRef = useRef<number | null>(null);

  const numValue = parseInt(value || "0", 10);
  const digits = String(numValue).padStart(2, "0").split("").map(Number);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    setIsDragging(true);
    dragStartY.current = e.clientY;
    dragStartValue.current = numValue;
    lastYRef.current = e.clientY;
    velocityRef.current = 0;
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
    }
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [numValue]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging) return;
    const deltaY = lastYRef.current - e.clientY;
    velocityRef.current = deltaY;
    lastYRef.current = e.clientY;

    const totalDelta = dragStartY.current - e.clientY;
    const step = Math.round(totalDelta / 20);
    let newValue = dragStartValue.current + step;
    newValue = Math.max(min, Math.min(max, newValue));
    onChange(String(newValue));
  }, [isDragging, onChange, min, max]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!isDragging) return;
    setIsDragging(false);
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);

    const velocity = velocityRef.current;
    if (Math.abs(velocity) > 5) {
      const applyMomentum = () => {
        const current = parseInt(value || "0", 10);
        const step = velocity > 0 ? -1 : 1;
        const newValue = Math.max(min, Math.min(max, current + step));
        onChange(String(newValue));
        velocityRef.current *= 0.85;
        if (Math.abs(velocityRef.current) > 1) {
          animationRef.current = requestAnimationFrame(applyMomentum);
        }
      };
      applyMomentum();
    }
  }, [isDragging, value, onChange, min, max]);

  const handleClick = (delta: number) => {
    let newValue = numValue + delta;
    newValue = Math.max(min, Math.min(max, newValue));
    onChange(String(newValue));
  };

  return (
    <Box sx={{ textAlign: "center", flex: 1 }}>
      <Typography variant="caption" fontWeight={600} color="text.secondary">{teamName}</Typography>
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
          gap: 0.5,
          mt: 1,
          py: 1,
          px: 2,
          borderRadius: 3,
          backgroundColor: alpha(isDragging ? "#1976d2" : "#000", 0.04),
          border: `2px solid ${isDragging ? "#1976d2" : "transparent"}`,
          cursor: isDragging ? "grabbing" : "grab",
          userSelect: "none",
          transition: "border-color 0.2s, background-color 0.2s",
          touchAction: "none",
          "&:hover": {
            backgroundColor: alpha("#1976d2", 0.08),
          },
        }}
      >
        <IconButton
          size="small"
          onClick={() => handleClick(-1)}
          onPointerDown={(e) => e.stopPropagation()}
          sx={{
            border: `1px solid ${alpha("#000", 0.15)}`,
            borderRadius: 2,
            width: 32,
            height: 32,
          }}
        >
          <RemoveIcon fontSize="small" />
        </IconButton>

        <Box sx={{ display: "flex", gap: 0.25 }}>
          {digits.map((digit, idx) => (
            <Box
              key={idx}
              sx={{
                width: 36,
                height: 52,
                overflow: "hidden",
                position: "relative",
                borderRadius: 1,
                backgroundColor: alpha("#000", 0.06),
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Typography
                sx={{
                  fontSize: "2rem",
                  fontWeight: 700,
                  lineHeight: 1,
                  color: "text.primary",
                  transition: "transform 0.05s",
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
            border: `1px solid ${alpha("#000", 0.15)}`,
            borderRadius: 2,
            width: 32,
            height: 32,
          }}
        >
          <AddIcon fontSize="small" />
        </IconButton>
      </Box>
      <Typography variant="caption" color="text.disabled" sx={{ mt: 0.5, display: "block" }}>
        drag to roll
      </Typography>
    </Box>
  );
}
