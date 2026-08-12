/* eslint-disable @eslint-react/set-state-in-effect, react-hooks/set-state-in-effect -- Sync-from-server pattern: server data initializes local state, async fetch responses set state. Common in this codebase. */
import { useState, useEffect, useCallback, useRef } from "react";
import {
  Paper, Typography, Stack, Box, Button, alpha, useTheme,
  LinearProgress, Chip, Alert,
} from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import RadioButtonUncheckedIcon from "@mui/icons-material/RadioButtonUnchecked";
import EmojiEventsIcon from "@mui/icons-material/EmojiEvents";
import PaymentsIcon from "@mui/icons-material/Payments";
import CelebrationIcon from "@mui/icons-material/Celebration";
import HowToRegIcon from "@mui/icons-material/HowToReg";
import SaveIcon from "@mui/icons-material/Save";
import { useT } from "~/lib/useT";
import { MvpVotingCard } from "./MvpVotingCard";
import { PaymentConfigDialog } from "./PaymentConfigDialog";

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
  mvpEnabled: boolean;
  mvpComplete: boolean;
  bannerMvpComplete: boolean;
  scoreOne: number | null;
  scoreTwo: number | null;
  teamOneName: string;
  teamTwoName: string;
  gamePayments: Array<{ eventPlayerId: string; name: string; amount: number; status: string; isPayer: boolean }> | null;
  gameConfig: { gameId: string; mode: "tracked" | "untracked"; payerName: string | null; payerIsPlayer: boolean } | null;
}

interface Props {
  eventId: string;
  onScrollToScore?: () => void;
  onScrollToPayments?: () => void;
  onStatusChange?: (status: PostGameStatus | null) => void;
  refreshKey?: number;
  isManager?: boolean;
}

export function PostGameBanner({ eventId, onScrollToScore, onScrollToPayments, onStatusChange, refreshKey, isManager = false }: Props) {
  const t = useT();
  const theme = useTheme();
  const [status, setStatus] = useState<PostGameStatus | null>(null);
  const [editablePayments, setEditablePayments] = useState<PaymentEntry[]>([]);
  const [paymentsDirty, setPaymentsDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [configOpen, setConfigOpen] = useState(false);

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

  // Payment overhaul: settle / revert a GamePayment share from the banner (owner).
  const handleToggleShare = async (row: { eventPlayerId: string; status: string; isPayer: boolean }) => {
    if (!status?.gameConfig) return;
    if (row.isPayer) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/events/${eventId}/payments/settlement`, {
        method: row.status === "paid" ? "DELETE" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gameId: status.gameConfig.gameId, eventPlayerId: row.eventPlayerId }),
      });
      if (!res.ok) setSaveError(t("somethingWentWrong"));
    } catch {
      setSaveError(t("somethingWentWrong"));
    } finally {
      setSaving(false);
      fetchStatus();
    }
  };

  // Sync editable payments when status loads for the first time
  useEffect(() => {
    if (status?.paymentsSnapshot && editablePayments.length === 0) {
      setEditablePayments(status.paymentsSnapshot);
    }
  }, [status?.paymentsSnapshot, editablePayments.length]);

  // Only show to people involved in settling this game: participants (teams or
  // payment roll), debtors, and the Owner/Admin. Spectators get nothing.
  // Everyone who sees the banner can settle it — toggling who paid and the
  // score are shared wrap-up tasks between the players and the admin.
  // Untracked games (each one pays their own share) never reach a "nothing left
  // to settle" state — allPaid is true by definition — so the allComplete
  // dismissal must not hide the wrap-up banner for them.
  if (!status || !status.isParticipant || (!status.gameEnded && !status.hasPendingPastPayments && (status.mvpComplete || !status.mvpEnabled)) || (status.allComplete && status.gameConfig?.mode !== "untracked")) return null;

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
    setSaveError(null);
    try {
      const res = await fetch(`/api/events/${eventId}/history/${status.latestHistoryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentsSnapshot: editablePayments }),
      });
      if (!res.ok) {
        setSaveError(res.status === 403 ? t("postGamePaymentsLocked") : t("somethingWentWrong"));
      } else {
        setPaymentsDirty(false);
        fetchStatus();
      }
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
                            .replace("{total}", String(editablePayments.length))}
                  </Typography>
                </Box>
                {!status.hasCost && (
                  <Button size="small" variant="outlined" color="info" onClick={onScrollToPayments}>
                    {t("postGameSetCost")}
                  </Button>
                )}
                {status.gameConfig?.mode === "untracked" && status.hasCost && (
                  <Typography variant="caption" color="text.secondary">
                    {t("paymentsUntrackedNote")}
                  </Typography>
                )}
              </Box>

              {/* Payment overhaul: config summary / prompt (new-model games) */}
              {status.gamePayments && status.gameConfig?.mode === "tracked" && status.hasCost && (
                <Box sx={{ mt: 1.5, pt: 1, borderTop: `1px dashed ${alpha(theme.palette.divider, 0.3)}`, display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                  {status.gameConfig.payerName ? (
                    <Typography variant="body2" fontWeight={600}>
                      {t("paymentsIsOwed", {
                        name: status.gameConfig.payerName,
                        amount: status.gamePayments
                          .filter((r) => r.status !== "paid")
                          .reduce((s, r) => s + r.amount, 0)
                          .toFixed(2),
                      })}
                    </Typography>
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      {t("paymentsUnassignedPayer")}
                    </Typography>
                  )}
                  {isManager && (
                    <Button size="small" variant="text" onClick={() => setConfigOpen(true)} sx={{ ml: "auto" }}>
                      {t("paymentsConfigTitle")}
                    </Button>
                  )}
                </Box>
              )}

              {/* Inline payment chips — new-model rows when present, else legacy snapshot */}
              {status.gamePayments && status.gamePayments.length > 0 ? (
                <Box sx={{ mt: 1.5, pt: 1, borderTop: `1px dashed ${alpha(theme.palette.divider, 0.3)}` }}>
                  <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
                    {status.gamePayments.map((r) => {
                      const isPaid = r.status === "paid";
                      const chipColor = isPaid ? "success" : r.status === "sent" ? "info" : "warning";
                      return (
                        <Chip
                          key={r.eventPlayerId}
                          size="small"
                          variant={isPaid ? "filled" : "outlined"}
                          color={chipColor}
                          label={`${r.name}  ${r.amount.toFixed(2)}${r.isPayer ? ` · ${t("paymentsPayer")}` : ""}`}
                          onClick={isManager && !r.isPayer ? () => handleToggleShare(r) : undefined}
                          sx={{ borderRadius: 2, fontWeight: isPaid ? 600 : 500, cursor: isManager && !r.isPayer ? "pointer" : "default" }}
                        />
                      );
                    })}
                  </Box>
                </Box>
              ) : hasPayments && !status.allPaid ? (
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
                          onClick={() => cyclePaymentStatus(idx)}
                          sx={{
                            borderRadius: 2,
                            fontWeight: isPaid ? 600 : 400,
                            cursor: "pointer",
                          }}
                        />
                      );
                    })}
                  </Box>
                  {paymentsDirty && (
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
                  {saveError && (
                    <Alert severity="warning" sx={{ mt: 1, borderRadius: 2 }} onClose={() => setSaveError(null)}>
                      {saveError}
                    </Alert>
                  )}
                </Box>
              ) : null}
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
      <PaymentConfigDialog
        open={configOpen}
        eventId={eventId}
        game={
          status?.gameConfig && status.gamePayments
            ? { ...status.gameConfig, rows: status.gamePayments }
            : null
        }
        onClose={() => setConfigOpen(false)}
        onSaved={async () => {
          setConfigOpen(false);
          fetchStatus();
        }}
      />
    </Paper>
  );
}
