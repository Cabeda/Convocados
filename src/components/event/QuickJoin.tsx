/* eslint-disable @eslint-react/set-state-in-effect, react-hooks/set-state-in-effect -- Sync-from-server pattern: fetch sets state. Common in this codebase. */
import React, { useState, useEffect, useCallback } from "react";
import {
  Paper, Typography, Box, Stack, Chip, Button, alpha, useTheme,
  Dialog, DialogTitle, DialogContent, DialogActions, Alert,
  FormControlLabel, Switch,
} from "@mui/material";
import PersonAddIcon from "@mui/icons-material/PersonAdd";
import EmojiPeopleIcon from "@mui/icons-material/EmojiPeople";
import AirlineSeatReclineNormalIcon from "@mui/icons-material/AirlineSeatReclineNormal";
import PaymentsIcon from "@mui/icons-material/Payments";
import WhatshotIcon from "@mui/icons-material/Whatshot";
import { useT } from "~/lib/useT";
import type { Player } from "./types";

interface BalanceData {
  enforcement: string;
  threshold: number;
  callerBalance: { playerName: string; amount: number; gamesOwed: number; streak: number } | null;
  aggregate: { paidCount: number; totalCount: number };
}

interface Props {
  eventId: string;
  userName: string;
  players: Player[];
  maxPlayers: number;
  onJoin: (name: string, linkToAccount?: boolean) => Promise<void>;
  onLeave: (id: string) => Promise<void>;
  autoOpenPay?: boolean;
}

export function QuickJoin({ eventId, userName, players, maxPlayers, onJoin, onLeave, autoOpenPay }: Props) {
  const t = useT();
  const theme = useTheme();
  const [joining, setJoining] = useState(false);
  const [balanceData, setBalanceData] = useState<BalanceData | null>(null);
  const [showInterstitial, setShowInterstitial] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [autoPayOnJoin, setAutoPayOnJoin] = useState(false);
  const [autoOpenTriggered, setAutoOpenTriggered] = useState(false);

  const joined = players.find((p) => p.name.toLowerCase() === userName.toLowerCase());
  const isOnBench = joined ? players.indexOf(joined) >= maxPlayers : false;

  const fetchBalance = useCallback(async () => {
    try {
      const res = await fetch(`/api/events/${eventId}/balance`);
      if (res.ok) setBalanceData(await res.json());
    } catch { /* ignore */ }
  }, [eventId]);

  useEffect(() => { fetchBalance(); }, [fetchBalance]);

  // Auto-open payment sheet from ?action=pay deep link
  useEffect(() => {
    if (autoOpenPay && balanceData && !autoOpenTriggered) {
      setAutoOpenTriggered(true);
      if (balanceData.callerBalance && balanceData.callerBalance.amount > 0) {
        setShowInterstitial(true);
      }
    }
  }, [autoOpenPay, balanceData, autoOpenTriggered]);

  // Load auto-pay-on-join preference from localStorage
  useEffect(() => {
    try {
      setAutoPayOnJoin(localStorage.getItem("autoPayOnJoin") === "true");
    } catch { /* ignore */ }
  }, []);

  const balance = balanceData?.callerBalance;
  const hasDebt = balance && balance.amount > 0;
  const enforcement = balanceData?.enforcement ?? "off";
  const aggregate = balanceData?.aggregate;

  const handleJoinClick = () => {
    if (!hasDebt || enforcement === "off") {
      doJoin();
      return;
    }
    // Show interstitial for nudge/soft_gate/hard_gate
    setShowInterstitial(true);
  };

  const doJoin = async () => {
    setShowInterstitial(false);
    setJoining(true);
    try {
      await onJoin(userName, true);
      // Auto-open payment sheet after join if user opted in
      if (autoPayOnJoin && hasDebt) {
        setTimeout(() => setShowInterstitial(true), 300);
      }
    } catch (err: unknown) {
      // Check if it's a 402 PAYMENT_GATE response
      if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "PAYMENT_GATE") {
        setBlocked(true);
      }
    }
    setJoining(false);
  };

  const handlePayAndJoin = async () => {
    // Mark as sent (self-report), then join
    if (balance) {
      try {
        await fetch(`/api/events/${eventId}/payments`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ playerName: balance.playerName, status: "sent" }),
        });
      } catch { /* non-blocking — still try to join */ }
    }
    await doJoin();
  };

  const handleLeave = async () => {
    if (!joined) return;
    setJoining(true);
    await onLeave(joined.id);
    setJoining(false);
  };

  // Determine button label
  const joinLabel = hasDebt && enforcement !== "off"
    ? t("paymentNudgePayAndJoin", { amount: balance.amount.toFixed(2) })
    : `${t("quickJoinBtn")} (${userName})`;

  return (
    <>
      <Paper elevation={3} sx={{
        borderRadius: 3, p: { xs: 2, sm: 3 },
        background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.08)}, ${alpha(theme.palette.secondary.main, 0.06)})`,
        border: `1px solid ${alpha(theme.palette.primary.main, 0.2)}`,
      }}>
        <Stack spacing={2}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <EmojiPeopleIcon color="primary" />
            <Typography variant="h6" fontWeight={700}>{t("quickJoinTitle")}</Typography>
          </Box>

          {/* Social proof signal */}
          {aggregate && aggregate.totalCount > 0 && (
            <Typography variant="body2" color="text.secondary">
              {t("paymentNudgeSocialProof", {
                paid: String(aggregate.paidCount),
                total: String(aggregate.totalCount),
              })}
            </Typography>
          )}

          {/* Payment streak */}
          {balance && balance.streak > 1 && (
            <Chip
              icon={<WhatshotIcon />}
              label={t("paymentNudgeStreak", { count: String(balance.streak) })}
              color="success"
              size="small"
              variant="outlined"
            />
          )}

          {/* Debt warning chip */}
          {hasDebt && enforcement !== "off" && !joined && (
            <Alert severity="warning" icon={<PaymentsIcon />} sx={{ borderRadius: 2 }}>
              {t("paymentNudgeBalance", {
                amount: balance.amount.toFixed(2),
                currency: "EUR",
                games: String(balance.gamesOwed),
              })}
            </Alert>
          )}

          {/* Blocked alert */}
          {blocked && (
            <Alert severity="error" sx={{ borderRadius: 2 }}>
              {t("paymentNudgeBlockedDesc", { amount: balance?.amount.toFixed(2) ?? "0", currency: "EUR" })}
            </Alert>
          )}

          {joined ? (
            <Box sx={{ display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap" }}>
              <Chip
                icon={isOnBench ? <AirlineSeatReclineNormalIcon /> : undefined}
                label={isOnBench ? t("youAreOnBench") : t("youArePlaying", { name: joined.name })}
                color={isOnBench ? "warning" : "success"}
                variant="filled"
              />
              <Button size="small" variant="outlined" color="error" onClick={handleLeave} disabled={joining}>
                {t("quickJoinLeave")}
              </Button>
            </Box>
          ) : (
            <Button
              variant="contained"
              onClick={handleJoinClick}
              disabled={joining || blocked}
              startIcon={hasDebt && enforcement !== "off" ? <PaymentsIcon /> : <PersonAddIcon />}
              color={hasDebt && enforcement !== "off" ? "warning" : "primary"}
            >
              {joinLabel}
            </Button>
          )}
        </Stack>
      </Paper>

      {/* Payment nudge interstitial */}
      <Dialog open={showInterstitial} onClose={() => setShowInterstitial(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t("paymentNudgeTitle")}</DialogTitle>
        <DialogContent>
          <Stack spacing={2}>
            <Typography>
              {t("paymentNudgeBalance", {
                amount: balance?.amount.toFixed(2) ?? "0",
                currency: "EUR",
                games: String(balance?.gamesOwed ?? 0),
              })}
            </Typography>
            {aggregate && aggregate.totalCount > 0 && (
              <Typography variant="body2" color="text.secondary">
                {t("paymentNudgeSocialProof", {
                  paid: String(aggregate.paidCount),
                  total: String(aggregate.totalCount),
                })}
              </Typography>
            )}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ flexDirection: "column", gap: 1, p: 2 }}>
          <Button
            variant="contained"
            color="warning"
            fullWidth
            onClick={handlePayAndJoin}
            startIcon={<PaymentsIcon />}
          >
            {t("paymentNudgePayAndJoin", { amount: balance?.amount.toFixed(2) ?? "0" })}
          </Button>
          <Button
            variant="text"
            size="small"
            color="inherit"
            onClick={doJoin}
            sx={{ opacity: 0.7 }}
          >
            {t("paymentNudgeJoinLater")}
          </Button>
          <FormControlLabel
            control={
              <Switch
                size="small"
                checked={autoPayOnJoin}
                onChange={(e) => {
                  const val = e.target.checked;
                  setAutoPayOnJoin(val);
                  try { localStorage.setItem("autoPayOnJoin", String(val)); } catch {}
                }}
              />
            }
            label={<Typography variant="caption" color="text.secondary">{t("autoPayOnJoinLabel")}</Typography>}
            sx={{ mt: 1 }}
          />
        </DialogActions>
      </Dialog>
    </>
  );
}
