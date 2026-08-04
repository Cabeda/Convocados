// ponytail: inline +/- stepper for score input. Sits next to the number so
// taps land close to the digits — the vertical +/pill/- layout was wasting
// vertical space and burying the controls far from the number.
import React from "react";
import { Box, IconButton, Typography, useTheme } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import RemoveIcon from "@mui/icons-material/Remove";

interface ScoreRollerProps {
  value: string;
  onChange?: (value: string) => void;
  teamName: string;
  min?: number;
  max?: number;
  hideLabel?: boolean;
  readOnly?: boolean;
}

export function ScoreRoller({
  value,
  onChange,
  teamName,
  min = 0,
  max = 99,
  hideLabel,
  readOnly,
}: ScoreRollerProps) {
  const theme = useTheme();
  const numValue = Math.max(min, Math.min(max, parseInt(value || "0", 10)));

  return (
    <Box sx={{ textAlign: "center", flex: 1, minWidth: 0 }}>
      {!hideLabel && (
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
      )}

      {readOnly ? (
        <Typography
          variant="h3"
          fontWeight={800}
          sx={{
            fontVariantNumeric: "tabular-nums",
            lineHeight: 1.2,
            color: "text.primary",
          }}
        >
          {String(numValue).padStart(2, "0")}
        </Typography>
      ) : (
        <Box
          sx={{
            display: "inline-flex",
            alignItems: "center",
            gap: 0.5,
            borderRadius: 999,
            border: `1px solid ${theme.palette.divider}`,
            bgcolor: theme.palette.action.hover,
            px: 0.5,
            py: 0.25,
          }}
        >
          <IconButton
            data-testid="score-minus"
            size="small"
            onClick={() => { if (numValue > min) onChange?.(String(numValue - 1)); }}
            disabled={numValue <= min}
            sx={{ p: 0.5 }}
          >
            <RemoveIcon fontSize="small" />
          </IconButton>
          <Typography
            sx={{
              fontSize: "2rem",
              fontWeight: 800,
              fontVariantNumeric: "tabular-nums",
              lineHeight: 1,
              minWidth: "2ch",
              textAlign: "center",
              color: "text.primary",
              px: 1,
            }}
          >
            {String(numValue).padStart(2, "0")}
          </Typography>
          <IconButton
            data-testid="score-plus"
            size="small"
            onClick={() => { if (numValue < max) onChange?.(String(numValue + 1)); }}
            disabled={numValue >= max}
            color="primary"
            sx={{ p: 0.5 }}
          >
            <AddIcon fontSize="small" />
          </IconButton>
        </Box>
      )}
    </Box>
  );
}
