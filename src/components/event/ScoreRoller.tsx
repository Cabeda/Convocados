// ponytail: simple +/- stepper for score input. The old drum-roller was
// finicky on touch — missed taps, accidental drags. This is more reliable.
import React from "react";
import { Box, Typography, useTheme } from "@mui/material";
import { alpha } from "@mui/material";

interface ScoreRollerProps {
  value: string;
  onChange: (value: string) => void;
  teamName: string;
  min?: number;
  max?: number;
}

export function ScoreRoller({ value, onChange, teamName, min = 0, max = 20 }: ScoreRollerProps) {
  const theme = useTheme();
  const numValue = Math.max(min, Math.min(max, parseInt(value || "0", 10)));

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
          mb: 0.5,
        }}
      >
        {teamName}
      </Typography>

      {/* Increment button */}
      <Box
        onClick={() => { if (numValue < max) onChange(String(numValue + 1)); }}
        sx={{
          display: "flex", justifyContent: "center", alignItems: "center",
          height: 36, cursor: numValue < max ? "pointer" : "default",
          opacity: numValue < max ? 1 : 0.3,
          color: theme.palette.primary.main,
          "&:active": { transform: "scale(0.9)" },
          transition: "transform 0.1s",
          userSelect: "none",
        }}
      >
        <Typography variant="h6" fontWeight={700}>+</Typography>
      </Box>

      {/* Score display */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: 72,
          borderRadius: 3,
          border: `2px solid ${alpha(theme.palette.primary.main, 0.25)}`,
          backgroundColor: alpha(theme.palette.primary.main, 0.06),
        }}
      >
        <Typography
          sx={{
            fontSize: "2.5rem",
            fontWeight: 800,
            fontVariantNumeric: "tabular-nums",
            lineHeight: 1,
            color: "text.primary",
          }}
        >
          {String(numValue).padStart(2, "0")}
        </Typography>
      </Box>

      {/* Decrement button */}
      <Box
        onClick={() => { if (numValue > min) onChange(String(numValue - 1)); }}
        sx={{
          display: "flex", justifyContent: "center", alignItems: "center",
          height: 36, cursor: numValue > min ? "pointer" : "default",
          opacity: numValue > min ? 1 : 0.3,
          color: theme.palette.primary.main,
          "&:active": { transform: "scale(0.9)" },
          transition: "transform 0.1s",
          userSelect: "none",
        }}
      >
        <Typography variant="h6" fontWeight={700}>−</Typography>
      </Box>
    </Box>
  );
}
