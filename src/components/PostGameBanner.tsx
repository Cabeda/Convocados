import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Paper, Typography, Stack, Box, Button, alpha, useTheme,
  LinearProgress, Chip,
} from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import RadioButtonUncheckedIcon from "@mui/icons-material/RadioButtonUnchecked";
import EmojiEventsIcon from "@mui/icons-material/EmojiEvents";
import PaymentsIcon from "@mui/icons-material/Payments";
import CelebrationIcon from "@mui/icons-material/Celebration";
import SaveIcon from "@mui/icons-material/Save";
import { useT } from "~/lib/useT";

interface PaymentEntry {
  playerName: string;
  amount: number;
  status: "paid" | "pending";
  method?: string | null;
}

export interface PostGameStatus {
  gameEnded: boolean;
  hasScore: boolean;
  hasCost: boolean;
  allPaid: boolean;
  allComplete: boolean;
  isParticipant: boolean;
  latestHistoryId: string | null;
  paymentsSnapshot: PaymentEntry[] | null;
  costCurrency: string | null;
  costAmount: number | null;
  hasPendingPastPayments: boolean;
}

interface Props {
  eventId: string;
  canEdit?: boolean;
  onScrollToScore?: () => void;
  onScrollToPayments?: () => void;
  onStatusChange?: (status: PostGameStatus | null) => void;
  refreshKey?: number;
}

export function PostGameBanner({ eventId, canEdit, onScrollToScore, onScrollToPayments, onStatusChange, refreshKey }: Props) {
  const t = useT();
  const theme = useTheme();
  const [status, setStatus] = useState<PostGameStatus | null>(null);
  const [editablePayments, setEditablePayments] = useState<PaymentEntry[]>([]);
  const [paymentsDirty, setPaymentsDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const onStatusChangeRef = useRef(onStatusChange);
  onStatusChangeRef.current = onStatusChange;

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/events/${eventId}/post-game-status`);
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
        onStatusChangeRef.current?.(data);
        // Reset editable payments from fresh data (only if not dirty)
        if (data.paymentsSnapshot && !paymentsDirty) {
          setEditablePayments(data.paymentsSnapshot);
        }
      }
    } catch { /* ignore */ }
  }, [eventId, paymentsDirty]);

  useEffect(() => {
    fetchStatus();
    const id = setInterval(fetchStatus, 15_000);
    return () => clearInterval(id);
  }, [fetchStatus]);

  useEffect(() => {
    if (refreshKey !== undefined && refreshKey > 0) fetchStatus();
  }, [refreshKey, fetchStatus]);

  // Sync editable payments when status loads for the first time
  useEffect(() => {
    if (status?.paymentsSnapshot && editablePayments.length === 0) {
      setEditablePayments(status.paymentsSnapshot);
    }
  }, [status?.paymentsSnapshot]);

  // Don't show if game hasn't ended (unless there are unsettled past payments) or everything is complete
  if (!status || (!status.gameEnded && !status.hasPendingPastPayments) || status.allComplete) return null;

  const completedCount = (status.hasScore ? 1 : 0) + (status.allPaid ? 1 : 0);
  const progressPct = (completedCount / 2) * 100;

  const cyclePaymentStatus = (idx: number) => {
    const order: Array<"paid" | "pending"> = ["pending", "paid"];
    setEditablePayments((prev) =>
      prev.map((p, i) => {
        if (i !== idx) return p;
        const next = order[(order.indexOf(p.status) + 1) % order.length];
        return { ...p, status: next };
      }),
    );
    setPaymentsDirty(true);
  };

  const handleSavePayments = async () => {
    if (!status.latestHistoryId) return;
    setSaving(true);
    try {
      await fetch(`/api/events/${eventId}/history/${status.latestHistoryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentsSnapshot: editablePayments }),
      });
      setPaymentsDirty(false);
      fetchStatus();
    } catch { /* ignore */ }
    setSaving(false);
  };

  const paidCount = editablePayments.filter((p) => p.status === "paid").length;
  const hasPayments = editablePayments.length > 0;

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
              sx={{
                p: 1.5,
                borderRadius: 2,
                bgcolor: status.allPaid
                  ? alpha(theme.palette.success.main, 0.08)
                  : !status.hasCost
                    ? alpha(theme.palette.info.main, 0.06)
                    : alpha(theme.palette.action.hover, 0.04),
                border: `1px solid ${status.allPaid ? alpha(theme.palette.success.main, 0.3) : !status.hasCost ? alpha(theme.palette.info.main, 0.3) : alpha(theme.palette.divider, 0.5)}`,
                transition: "all 0.2s",
              }}
            >
              <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
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
                    {status.allPaid
                      ? t("postGamePaymentsDone")
                      : !status.hasCost
                        ? t("postGameNoCostSet")
                        : t("postGamePaymentsSummary")
                            .replace("{paid}", String(paidCount))
                            .replace("{total}", String(editablePayments.length))}
                  </Typography>
                </Box>
                {!status.hasCost && (
                  <Button size="small" variant="outlined" color="info" onClick={onScrollToPayments}>
                    {t("postGameSetCost")}
                  </Button>
                )}
              </Box>

              {/* Inline payment chips */}
              {hasPayments && !status.allPaid && (
                <Box sx={{ mt: 1.5, pt: 1, borderTop: `1px dashed ${alpha(theme.palette.divider, 0.3)}` }}>
                  <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
                    {editablePayments.map((p, idx) => {
                      const isPaid = p.status === "paid";
                      const chipColor = isPaid ? "success" : "warning";
                      return (
                        <Chip
                          key={p.playerName}
                          size="small"
                          variant={isPaid ? "filled" : "outlined"}
                          color={chipColor}
                          label={`${p.playerName}  ${p.amount.toFixed(2)}`}
                          onClick={canEdit ? () => cyclePaymentStatus(idx) : undefined}
                          sx={{
                            borderRadius: 2,
                            fontWeight: isPaid ? 600 : 400,
                            ...(canEdit ? { cursor: "pointer" } : {}),
                          }}
                        />
                      );
                    })}
                  </Box>
                  {canEdit && paymentsDirty && (
                    <Box sx={{ mt: 1, display: "flex", justifyContent: "flex-end" }}>
                      <Button
                        size="small"
                        variant="contained"
                        color="warning"
                        disableElevation
                        startIcon={<SaveIcon />}
                        onClick={handleSavePayments}
                        disabled={saving}
                        sx={{ borderRadius: 2, textTransform: "none", fontWeight: 600 }}
                      >
                        {t("savePayments")}
                      </Button>
                    </Box>
                  )}
                </Box>
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
