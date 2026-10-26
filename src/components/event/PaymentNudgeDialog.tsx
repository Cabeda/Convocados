/* eslint-disable @eslint-react/set-state-in-effect, react-hooks/set-state-in-effect -- Sync-from-server pattern: fetch sets state. Common in this codebase. */
import { useState, useEffect, useCallback } from "react";
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, Stack, Typography, FormControlLabel, Switch,
} from "@mui/material";
import PaymentsIcon from "@mui/icons-material/Payments";
import { useT } from "~/lib/useT";
import { parsePaymentMethods } from "~/lib/paymentMethods";
import { perPlayerShare } from "~/lib/gameCost";
import { formatMoney, toCents } from "~/lib/money";
import { PaymentMethodsList } from "~/components/PaymentMethodsList";
import { apiRequest } from "~/lib/api/client";

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
  open: boolean;
  onClose: () => void;
  onJoin: () => Promise<void>;
}

export function PaymentNudgeDialog({ eventId, open, onClose, onJoin }: Props) {
  const t = useT();
  const [balanceData, setBalanceData] = useState<BalanceData | null>(null);
  const [autoPayOnJoin, setAutoPayOnJoin] = useState(false);
  const [paymentMethods, setPaymentMethods] = useState<ReturnType<typeof parsePaymentMethods>>([]);
  const [costCurrency, setCostCurrency] = useState("EUR");
  const [perPlayer, setPerPlayer] = useState(0);

  const fetchBalance = useCallback(async () => {
    try {
      const [balance, cost] = await Promise.all([
        apiRequest("GET /api/events/{id}/balance", { params: { id: eventId } }).catch(() => null),
        apiRequest("GET /api/events/{id}/cost", { params: { id: eventId } }).catch(() => null),
      ]);
      if (balance) setBalanceData(balance as BalanceData);
      if (cost) {
        const eventCost = cost as {
          effectivePaymentMethods?: string | null;
          currency?: string;
          maxPlayers?: number;
          totalAmount: number;
        };
        const methods = parsePaymentMethods(eventCost.effectivePaymentMethods);
        setPaymentMethods(methods);
        setCostCurrency(eventCost.currency ?? "EUR");
        // Per-player price = total / required playing slots (maxPlayers).
        const maxPlayers = eventCost.maxPlayers ?? 1;
        setPerPlayer(perPlayerShare(eventCost.totalAmount, maxPlayers));
      }
    } catch { /* ignore */ }
  }, [eventId]);

  useEffect(() => { if (open) fetchBalance(); }, [open, fetchBalance]);

  useEffect(() => {
    try { setAutoPayOnJoin(localStorage.getItem("autoPayOnJoin") === "true"); } catch {}
  }, []);

  const balance = balanceData?.callerBalance;
  const aggregate = balanceData?.aggregate;

  const handlePayAndJoin = async () => {
    if (balance) {
      try {
        await apiRequest("PUT /api/events/{id}/payments", {
          params: { id: eventId },
          body: { playerName: balance.playerName, status: "sent" },
        });
      } catch { /* non-blocking — still try to join */ }
    }
    await onJoin();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{t("paymentNudgeTitle")}</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <Typography>
            {t("paymentNudgeBalance", {
              amount: formatMoney(toCents(balance?.amount ?? 0), costCurrency),
              games: String(balance?.gamesOwed ?? 0),
            })}
          </Typography>
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
          {t("paymentNudgePayAndJoin", { amount: formatMoney(toCents(balance?.amount ?? 0), costCurrency) })}
        </Button>
        <Button
          variant="text"
          size="small"
          color="inherit"
          onClick={onJoin}
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
  );
}
