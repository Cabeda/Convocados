import React, { useState, useEffect, useCallback } from "react";
import {
  Paper, Typography, Stack, Box, Chip, Button, alpha, useTheme,
  LinearProgress,
} from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import RadioButtonUncheckedIcon from "@mui/icons-material/RadioButtonUnchecked";
import EmojiEventsIcon from "@mui/icons-material/EmojiEvents";
import PaymentsIcon from "@mui/icons-material/Payments";
import CelebrationIcon from "@mui/icons-material/Celebration";
import { useT } from "~/lib/useT";

export interface PostGameStatus {
  gameEnded: boolean;
  hasScore: boolean;
  allPaid: boolean;
  allComplete: boolean;
}

interface Props {
  eventId: string;
  onScrollToScore?: () => void;
  onScrollToPayments?: () => void;
  onStatusChange?: (status: PostGameStatus | null) => void;
}

export function PostGameBanner({ eventId, onScrollToScore, onScrollToPayments, onStatusChange }: Props) {
  const t = useT();
  const theme = useTheme();
  const [status, setStatus] = useState<PostGameStatus | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/events/${eventId}/post-game-status`);
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
        onStatusChange?.(data);
      }
    } catch { /* ignore */ }
  }, [eventId, onStatusChange]);

  useEffect(() => {
    fetchStatus();
    const id = setInterval(fetchStatus, 15_000);
    return () => clearInterval(id);
  }, [fetchStatus]);

  // Don't show if game hasn't ended or everything is complete
  if (!status || !status.gameEnded || status.allComplete) return null;

  const completedCount = (status.hasScore ? 1 : 0) + (status.allPaid ? 1 : 0);
  const progressPct = (completedCount / 2) * 100;

  return (
    <Paper
      elevation={3}
      data-testid="post-game-banner"
      sx={{
        borderRadius: 3,
        overflow: "hidden",
        background: `linear-gradient(135deg, ${alpha(theme.palette.warning.main, 0.08)} 0%, ${alpha(theme.palette.primary.main, 0.08)} 100%)`,
        border: `1px solid ${alpha(theme.palette.warning.main, 0.3)}`,
      }}
    >
      <LinearProgress
        variant="determinate"
        value={progressPct}
        sx={{
          height: 4,
          "& .MuiLinearProgress-bar": {
            background: `linear-gradient(90deg, ${theme.palette.warning.main}, ${theme.palette.success.main})`,
          },
        }}
      />
      <Box sx={{ p: { xs: 2, sm: 3 } }}>
        <Stack spacing={2}>
          {/* Header */}
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <CelebrationIcon sx={{ color: theme.palette.warning.main }} />
            <Typography variant="h6" fontWeight={700}>
              {t("postGameTitle")}
            </Typography>
          </Box>
          <Typography variant="body2" color="text.secondary">
            {t("postGameSubtitle")}
          </Typography>

          {/* Checklist */}
          <Stack spacing={1.5}>
            {/* Score task */}
            <Box
              onClick={onScrollToScore}
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1.5,
                p: 1.5,
                borderRadius: 2,
                cursor: status.hasScore ? "default" : "pointer",
                bgcolor: status.hasScore
                  ? alpha(theme.palette.success.main, 0.08)
                  : alpha(theme.palette.action.hover, 0.04),
                border: `1px solid ${status.hasScore ? alpha(theme.palette.success.main, 0.3) : alpha(theme.palette.divider, 0.5)}`,
                transition: "all 0.2s",
                "&:hover": !status.hasScore ? {
                  bgcolor: alpha(theme.palette.primary.main, 0.08),
                  borderColor: theme.palette.primary.main,
                } : {},
              }}
            >
              {status.hasScore ? (
                <CheckCircleIcon sx={{ color: theme.palette.success.main }} />
              ) : (
                <RadioButtonUncheckedIcon sx={{ color: theme.palette.text.disabled }} />
              )}
              <EmojiEventsIcon fontSize="small" sx={{ color: status.hasScore ? theme.palette.success.main : theme.palette.text.secondary }} />
              <Box sx={{ flex: 1 }}>
                <Typography
                  variant="body2"
                  fontWeight={600}
                  sx={{ textDecoration: status.hasScore ? "line-through" : "none" }}
                >
                  {t("postGameEnterScore")}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {status.hasScore ? t("postGameScoreDone") : t("postGameScorePending")}
                </Typography>
              </Box>
              {!status.hasScore && (
                <Button size="small" variant="outlined" color="primary" onClick={onScrollToScore}>
                  {t("postGameGoToScore")}
                </Button>
              )}
            </Box>

            {/* Payment task */}
            <Box
              onClick={onScrollToPayments}
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1.5,
                p: 1.5,
                borderRadius: 2,
                cursor: status.allPaid ? "default" : "pointer",
                bgcolor: status.allPaid
                  ? alpha(theme.palette.success.main, 0.08)
                  : alpha(theme.palette.action.hover, 0.04),
                border: `1px solid ${status.allPaid ? alpha(theme.palette.success.main, 0.3) : alpha(theme.palette.divider, 0.5)}`,
                transition: "all 0.2s",
                "&:hover": !status.allPaid ? {
                  bgcolor: alpha(theme.palette.primary.main, 0.08),
                  borderColor: theme.palette.primary.main,
                } : {},
              }}
            >
              {status.allPaid ? (
                <CheckCircleIcon sx={{ color: theme.palette.success.main }} />
              ) : (
                <RadioButtonUncheckedIcon sx={{ color: theme.palette.text.disabled }} />
              )}
              <PaymentsIcon fontSize="small" sx={{ color: status.allPaid ? theme.palette.success.main : theme.palette.text.secondary }} />
              <Box sx={{ flex: 1 }}>
                <Typography
                  variant="body2"
                  fontWeight={600}
                  sx={{ textDecoration: status.allPaid ? "line-through" : "none" }}
                >
                  {t("postGameCompletePayments")}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {status.allPaid ? t("postGamePaymentsDone") : t("postGamePaymentsPending")}
                </Typography>
              </Box>
              {!status.allPaid && (
                <Button size="small" variant="outlined" color="primary" onClick={onScrollToPayments}>
                  {t("postGameGoToPayments")}
                </Button>
              )}
            </Box>
          </Stack>

          {/* Progress summary */}
          <Typography variant="caption" color="text.secondary" sx={{ textAlign: "center" }}>
            {t("postGameProgress").replace("{done}", String(completedCount)).replace("{total}", "2")}
          </Typography>
        </Stack>
      </Box>
    </Paper>
  );
}
