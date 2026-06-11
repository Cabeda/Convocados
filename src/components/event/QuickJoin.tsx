/* eslint-disable @eslint-react/set-state-in-effect, react-hooks/set-state-in-effect -- Sync-from-server pattern: fetch sets state. Common in this codebase. */
import React, { useState, useEffect, useCallback } from "react";
import {
  Paper, Typography, Box, Stack, Chip, Button, alpha, useTheme,
  Dialog, DialogTitle, DialogContent, DialogActions, Alert,
} from "@mui/material";
import PersonAddIcon from "@mui/icons-material/PersonAdd";
import EmojiPeopleIcon from "@mui/icons-material/EmojiPeople";
import AirlineSeatReclineNormalIcon from "@mui/icons-material/AirlineSeatReclineNormal";
import PaymentsIcon from "@mui/icons-material/Payments";
import WhatshotIcon from "@mui/icons-material/Whatshot";
import { useT } from "~/lib/useT";
import { parsePaymentMethods } from "~/lib/paymentMethods";
import { PaymentMethodsList } from "~/components/PaymentMethodsList";
import type { Player } from "./types";

interface BalanceData {
  enforcement: string;
  threshold: number;
  callerBalance: { playerName: string; amount: number; gamesOwed: number; streak: number } | null;
  aggregate: { paidCount: number; totalCount: number };
  paymentMethods?: string | null;
  currency?: string;
  perPlayer?: number;
}

interface Props {
  eventId: string;
  userName: string;
  players: Player[];
  maxPlayers: number;
  onJoin: (name: string, linkToAccount?: boolean) => Promise<void>;
  onLeave: (id: string) => Promise<void>;
}

export function QuickJoin({ eventId, userName, players, maxPlayers, onJoin, onLeave }: Props) {
  const t = useT();
  const theme = useTheme();
  const [joining, setJoining] = useState(false);
  const [balanceData, setBalanceData] = useState<BalanceData | null>(null);
  const [showInterstitial, setShowInterstitial] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [paymentMethods, setPaymentMethods] = useState<ReturnType<typeof parsePaymentMethods>>([]);
  const [costCurrency, setCostCurrency] = useState("EUR");
  const [perPlayer, setPerPlayer] = useState(0);

  const joined = players.find((p) => p.name.toLowerCase() === userName.toLowerCase());
  const isOnBench = joined ? players.indexOf(joined) >= maxPlayers : false;

  const fetchBalance = useCallback(async () => {
    try {
      const [balRes, costRes] = await Promise.all([
        fetch(`/api/events/${eventId}/balance`),
        fetch(`/api/events/${eventId}/cost`),
      ]);
      if (balRes.ok) setBalanceData(await balRes.json());
      if (costRes.ok) {
        const cost = await costRes.json();
        if (cost) {
          const methods = parsePaymentMethods(cost.effectivePaymentMethods);
          setPaymentMethods(methods);
          setCostCurrency(cost.currency ?? "EUR");
          const playerCount = cost.payments?.length ?? 1;
          setPerPlayer(playerCount > 0 ? cost.totalAmount / playerCount : 0);
        }
      }
    } catch { /* ignore */ }
  }, [eventId]);

  useEffect(() => { fetchBalance(); }, [fetchBalance]);

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
              {/* Pay button for joined players with pending payment */}
              {hasDebt && enforcement !== "off" && (
                <Button
                  size="small"
                  variant="contained"
                  color="warning"
                  startIcon={<PaymentsIcon />}
                  onClick={() => setShowInterstitial(true)}
                >
                  {t("paymentNudgePayAndJoin", { amount: balance.amount.toFixed(2) })}
                </Button>
              )}
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
                currency: costCurrency,
                games: String(balance?.gamesOwed ?? 0),
              })}
            </Typography>
            {/* Payment methods with deep links */}
            {paymentMethods.length > 0 && (
              <PaymentMethodsList methods={paymentMethods} amount={perPlayer} currency={costCurrency} />
            )}
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
            {joined ? t("paymentNudgeMarkSent") : t("paymentNudgePayAndJoin", { amount: balance?.amount.toFixed(2) ?? "0" })}
          </Button>
          {!joined && (
            <Button
              variant="text"
              size="small"
              color="inherit"
              onClick={doJoin}
              sx={{ opacity: 0.7 }}
            >
              {t("paymentNudgeJoinLater")}
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </>
  );
}
