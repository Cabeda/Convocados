import { useState, useEffect, useCallback } from "react";
import {
  Box, Typography, Button, Stack, Chip, Paper, alpha, useTheme, Alert,
} from "@mui/material";
import PaymentsIcon from "@mui/icons-material/Payments";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import { useT } from "~/lib/useT";

interface CostData {
  totalAmount: number;
  currency: string;
  effectivePaymentMethods: string | null;
}

interface DebtorLine {
  gameId: string;
  dateTime: string;
  amount: number;
  status: string;
  role: "debtor" | "payer";
}

interface SummaryPerson {
  name: string;
  isPlayer: boolean;
  owedAmount: number;
  lines: DebtorLine[];
}

interface SettlementSummary {
  people: SummaryPerson[];
  viewerEventPlayerId: string | null;
  viewerRole: string;
}

const fmt = (n: number, currency: string) => `${n.toFixed(2)}${currency || "€"}`;
const fmtDate = (iso: string) =>
  new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(new Date(iso));

/**
 * The event page's payment surface (replaces the old "Split the cost" accordion).
 * Shows a compact price line + a targeted "you owe" CTA for players with an
 * unpaid share; all management happens on the payments page.
 */
export function PaymentSurface({
  eventId,
  canEdit,
  isAuthenticated,
  playerCount,
}: {
  eventId: string;
  canEdit: boolean;
  isAuthenticated: boolean;
  playerCount: number;
}) {
  const t = useT();
  const theme = useTheme();
  const [cost, setCost] = useState<CostData | null>(null);
  const [summary, setSummary] = useState<SettlementSummary | null>(null);
  const [reporting, setReporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const costRes = await fetch(`/api/events/${eventId}/cost`);
      if (costRes.ok) setCost(await costRes.json());
      const sumRes = await fetch(`/api/events/${eventId}/payments/settlement`);
      if (sumRes.ok) setSummary(await sumRes.json());
    } catch { /* ignore */ }
  }, [eventId]);

  useEffect(() => { load(); }, [load]);

  if (!isAuthenticated) return null;

  const hasCost = !!cost && cost.totalAmount > 0;
  const share = hasCost && playerCount > 0 ? cost.totalAmount / playerCount : null;

  // The viewer's own debtor person (summary is role-trimmed for players).
  const myDebt = !canEdit
    ? summary?.people?.find((p) => p.isPlayer && p.owedAmount > 0)
    : undefined;
  const pendingLines = myDebt?.lines.filter((l) => l.role === "debtor" && l.status === "pending") ?? [];
  const sentLines = myDebt?.lines.filter((l) => l.role === "debtor" && l.status === "sent") ?? [];

  const goToPayments = () => { window.location.href = `/events/${eventId}/payments`; };

  const reportSent = async (line: DebtorLine) => {
    if (!summary?.viewerEventPlayerId) return;
    setReporting(true);
    setError(null);
    try {
      const res = await fetch(`/api/events/${eventId}/payments/settlement/self-report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gameId: line.gameId, eventPlayerId: summary.viewerEventPlayerId }),
      });
      if (!res.ok) setError(t("paymentsFailed"));
      await load();
    } catch {
      setError(t("paymentsFailed"));
    } finally {
      setReporting(false);
    }
  };

  return (
    <Paper id="payment-surface" elevation={0} variant="outlined" sx={{ borderRadius: 3, p: 1.5, mb: 2, borderColor: alpha(theme.palette.divider, 0.5) }}>
      <Stack spacing={1}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
          <PaymentsIcon fontSize="small" color="action" />
          {hasCost ? (
            <Typography variant="body2" fontWeight={600}>
              {fmt(cost.totalAmount, cost.currency)}
              {share ? ` · ${t("perPlayer", { amount: fmt(share, cost.currency) })}` : ""}
            </Typography>
          ) : canEdit ? (
            <Button size="small" onClick={goToPayments}>{t("setPrice")}</Button>
          ) : null}
          <Button
            size="small"
            endIcon={<ArrowForwardIcon />}
            onClick={goToPayments}
            sx={{ ml: "auto" }}
          >
            {t("postGameGoToPayments")}
          </Button>
        </Box>

        {!canEdit && myDebt && (
          <Box sx={{ px: 0.5, pb: 0.5 }}>
            <Typography variant="body2" color="warning.main" fontWeight={600}>
              {t("youOwe", { amount: fmt(myDebt.owedAmount, cost?.currency ?? "EUR") })}
            </Typography>
            {pendingLines.map((line) => (
              <Box key={line.gameId} sx={{ display: "flex", alignItems: "center", gap: 1, mt: 0.5, flexWrap: "wrap" }}>
                <Chip size="small" variant="outlined" color="warning" label={`${fmtDate(line.dateTime)} · ${fmt(line.amount, cost?.currency ?? "EUR")}`} />
                <Button size="small" variant="outlined" disabled={reporting} onClick={() => reportSent(line)}>
                  {t("paymentsReportSent")}
                </Button>
              </Box>
            ))}
            {sentLines.length > 0 && (
              <Typography variant="caption" color="text.secondary">
                {sentLines.map((l) => fmtDate(l.dateTime)).join(", ")} · {t("paymentsStatusSent")}
              </Typography>
            )}
          </Box>
        )}

        {error && <Alert severity="error" sx={{ borderRadius: 2 }}>{error}</Alert>}
      </Stack>
    </Paper>
  );
}
