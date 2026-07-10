/* eslint-disable @eslint-react/set-state-in-effect, react-hooks/set-state-in-effect -- Sync-from-server pattern: server data initializes local state, async fetch responses set state. Common in this codebase. */
import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Paper, Typography, Stack, Box, Button, alpha, useTheme,
  LinearProgress,
} from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import RadioButtonUncheckedIcon from "@mui/icons-material/RadioButtonUnchecked";
import EmojiEventsIcon from "@mui/icons-material/EmojiEvents";
import PaymentsIcon from "@mui/icons-material/Payments";
import CelebrationIcon from "@mui/icons-material/Celebration";
import HowToRegIcon from "@mui/icons-material/HowToReg";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import { useT } from "~/lib/useT";
import { MvpVotingCard } from "./MvpVotingCard";
import { PaymentChips } from "./PaymentChips";

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
  paymentWriteMode: "editable" | "historical" | "live" | "none";
  editable: boolean;
  costCurrency: string | null;
  costAmount: number | null;
  hasPendingPastPayments: boolean;
  mvpEnabled: boolean;
  mvpComplete: boolean;
  bannerMvpComplete: boolean;
  scoreOne: number | null;
  scoreTwo: number | null;
  teamOneName: string;
  teamTwoName: string;
}

interface Props {
  eventId: string;
  canEdit?: boolean;
  onScrollToScore?: () => void;
  onScrollToPayments?: () => void;
  onStatusChange?: (status: PostGameStatus | null) => void;
  refreshKey?: number;
}

export function PostGameBanner({ eventId, canEdit, onScrollToScore, onScrollToPayments: _onScrollToPayments, onStatusChange, refreshKey }: Props) {
  const t = useT();
  const theme = useTheme();
  const [status, setStatus] = useState<PostGameStatus | null>(null);
  const [savingPlayer, setSavingPlayer] = useState<string | null>(null);

  const onStatusChangeRef = useRef(onStatusChange);
  useEffect(() => {
    onStatusChangeRef.current = onStatusChange;
  }, [onStatusChange]);

  const fetchStatus = useCallback(async () => {
    try {
      const statusRes = await fetch(`/api/events/${eventId}/post-game-status`);
      if (statusRes.ok) {
        const data = await statusRes.json();
        setStatus(data);
        onStatusChangeRef.current?.(data);
      }
    } catch { /* ignore */ }
  }, [eventId]);

  useEffect(() => {
    fetchStatus();
    const id = setInterval(fetchStatus, 15_000);
    return () => clearInterval(id);
  }, [fetchStatus]);

  useEffect(() => {
    if (refreshKey !== undefined && refreshKey > 0) fetchStatus();
  }, [refreshKey, fetchStatus]);

  // Toggles a single player's payment status (paid <-> pending) when the
  // viewer is permitted (owner/admin or a participant of that game).
  //  - editable: game still in its editable window → PATCH /history/:id
  //    (bidirectional, mirrors the history page)
  //  - live: game ended but not reset → PUT /payments (bidirectional)
  //  - historical: frozen settled game → POST /payments/historical to mark
  //    paid only (a frozen snapshot can't be un-paid from the UI)
  const togglePlayerPaid = async (playerName: string, currentStatus: string) => {
    // Prevent double-click / rapid toggles
    if (savingPlayer) return;
    const newStatus = currentStatus === "paid" ? "pending" : "paid";
    setSavingPlayer(playerName);
    try {
      if (status?.paymentWriteMode === "editable" && status.latestHistoryId) {
        const next = (status.paymentsSnapshot ?? []).map((p) =>
          p.playerName === playerName ? { ...p, status: newStatus } : p,
        );
        await fetch(`/api/events/${eventId}/history/${status.latestHistoryId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paymentsSnapshot: next }),
        });
      } else if (status?.paymentWriteMode === "live") {
        await fetch(`/api/events/${eventId}/payments`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ playerName, status: newStatus }),
        });
      } else if (status?.paymentWriteMode === "historical" && status.latestHistoryId) {
        // Frozen: only allow marking paid, never un-paying.
        if (newStatus !== "paid") return;
        await fetch(`/api/events/${eventId}/payments/historical`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ gameHistoryId: status.latestHistoryId, playerName }),
        });
      }
      await fetchStatus();
    } catch { /* ignore */ }
    setSavingPlayer(null);
  };

  // Don't show if game hasn't ended (unless there are unsettled past payments or pending MVP votes) or everything is complete
  if (!status || (!status.gameEnded && !status.hasPendingPastPayments && (status.mvpComplete || !status.mvpEnabled)) || status.allComplete) return null;

  const completedCount = (status.hasScore ? 1 : 0) + (status.allPaid ? 1 : 0);
  const progressPct = (completedCount / 2) * 100;

  const paidCount = status.paymentsSnapshot?.filter((p) => p.status === "paid").length ?? 0;
  const totalCount = status.paymentsSnapshot?.length ?? 0;

  // Permitted togglers: owner/admin (canEdit) or a participant of that game.
  const canTogglePayments = canEdit || !!status.isParticipant;
  // Frozen settled games can be marked paid but never un-paid from the UI.
  const isFrozenHistorical = status.paymentWriteMode === "historical";

  const onToggleBanner = (idx: number) => {
    if (savingPlayer) return;
    const p = status?.paymentsSnapshot?.[idx];
    if (p) togglePlayerPaid(p.playerName, p.status);
  };
  const savingIdx = savingPlayer
    ? (status?.paymentsSnapshot?.findIndex((p) => p.playerName === savingPlayer) ?? null)
    : null;

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

          {/* Score hero — celebrate the result when score is set */}
          {status.hasScore && status.scoreOne !== null && status.scoreTwo !== null && (
            <Box sx={{
              display: "flex", alignItems: "center", justifyContent: "center", gap: 3,
              py: 2, px: 3, borderRadius: 3,
              bgcolor: alpha(theme.palette.success.main, 0.06),
              border: `1px solid ${alpha(theme.palette.success.main, 0.2)}`,
            }}>
              <Box sx={{ textAlign: "center" }}>
                <Typography variant="caption" color="text.secondary" fontWeight={600}>
                  {status.teamOneName}
                </Typography>
                <Typography variant="h4" fontWeight={800}>
                  {status.scoreOne}
                </Typography>
              </Box>
              <Typography variant="h5" color="text.disabled" fontWeight={300}>–</Typography>
              <Box sx={{ textAlign: "center" }}>
                <Typography variant="caption" color="text.secondary" fontWeight={600}>
                  {status.teamTwoName}
                </Typography>
                <Typography variant="h4" fontWeight={800}>
                  {status.scoreTwo}
                </Typography>
              </Box>
            </Box>
          )}

          {/* Subtitle — only show when score is NOT set (otherwise the hero replaces it) */}
          {!status.hasScore && (
            <Typography variant="body2" color="text.secondary">
              {t("postGameSubtitle")}
            </Typography>
          )}

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
                            .replace("{total}", String(totalCount))}
                  </Typography>
                </Box>
                {/* Read-only: link to Settle page for full payment management (ADR 0020) */}
                {status.hasCost && (
                  <Button
                    size="small"
                    variant="outlined"
                    color={status.allPaid ? "success" : "warning"}
                    component="a"
                    href={`/events/${eventId}/settle`}
                    endIcon={<OpenInNewIcon fontSize="small" />}
                    sx={{ textTransform: "none", whiteSpace: "nowrap" }}
                  >
                    {t("paymentsViewAll")}
                  </Button>
                )}
                {!status.hasCost && (
                  <Button
                    size="small"
                    variant="outlined"
                    color="info"
                    component="a"
                    href={`/events/${eventId}/settle`}
                  >
                    {t("postGameSetCost")}
                  </Button>
                )}
              </Box>

              {/* Payment summary chips. Owner/admin or a game participant can
                  tap a pill to toggle that player's payment (paid <-> pending). */}
              {totalCount > 0 && canTogglePayments && (
                <Box sx={{ mt: 1.5, pt: 1, borderTop: `1px dashed ${alpha(theme.palette.divider, 0.3)}` }}>
                  <PaymentChips
                    payments={status.paymentsSnapshot ?? []}
                    editable
                    onToggle={onToggleBanner}
                    savingIdx={savingIdx}
                    isDisabled={(p) => isFrozenHistorical && p.status === "paid"}
                    showMethodRefs
                  />
                </Box>
              )}
            </Box>

            {/* MVP voting task */}
            {status.mvpEnabled && status.latestHistoryId && status.hasScore && (
              <Box sx={{
                p: 1.5,
                borderRadius: 2,
                bgcolor: alpha(theme.palette.action.hover, 0.04),
                border: `1px solid ${alpha(theme.palette.divider, 0.5)}`,
              }}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 1 }}>
                  <HowToRegIcon fontSize="small" sx={{ color: theme.palette.warning.main }} />
                  <Typography variant="body2" fontWeight={600}>
                    {t("voteMvp")}
                  </Typography>
                </Box>
                <MvpVotingCard
                  eventId={eventId}
                  historyId={status.latestHistoryId}
                  compact
                />
              </Box>
            )}
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
