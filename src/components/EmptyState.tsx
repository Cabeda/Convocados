import React from "react";
import { Box, Typography, Button, Paper } from "@mui/material";
import type { SvgIconComponent } from "@mui/icons-material";

export interface EmptyStateProps {
  icon:SvgIconComponent;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  secondaryAction?: {
    label: string;
    onClick: () => void;
  };
}

export function EmptyState({ icon: Icon, title, description, action, secondaryAction }: EmptyStateProps) {
  return (
    <Paper
      elevation={0}
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        p: 4,
        py: 6,
        backgroundColor: "transparent",
      }}
    >
      <Box
        sx={{
          width: 80,
          height: 80,
          borderRadius: "50%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "action.hover",
          mb: 2,
        }}
      >
        <Icon sx={{ fontSize: 40, color: "text.secondary" }} />
      </Box>

      <Typography variant="h6" gutterBottom>
        {title}
      </Typography>

      {description && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2, maxWidth: 400 }}>
          {description}
        </Typography>
      )}

      {action && (
        <Button variant="contained" onClick={action.onClick} sx={{ mt: 1 }}>
          {action.label}
        </Button>
      )}

      {secondaryAction && (
        <Button variant="text" onClick={secondaryAction.onClick} sx={{ mt: 1 }}>
          {secondaryAction.label}
        </Button>
      )}
    </Paper>
  );
}