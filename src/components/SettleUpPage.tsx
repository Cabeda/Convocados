/* eslint-disable react-hooks/set-state-in-effect -- Sync-from-server pattern: server data initializes local state, async fetch responses set state. Common in this codebase. */
import React, { useEffect, useState, useCallback } from "react";
import {
  Box, Stack, Typography, Alert, Chip,
  Table, TableBody, TableCell, TableHead, TableRow, TextField, Button,
  CircularProgress, IconButton, Divider, Tab, Tabs, Paper, Menu, MenuItem, ListItemText,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { useT } from "~/lib/useT";
import { ThemeModeProvider } from "./ThemeModeProvider";
import { ResponsiveLayout } from "./ResponsiveLayout";
import { PaymentMethodOverrideDialog } from "./event/PaymentMethodOverrideDialog";
import { SettleHero } from "./settle/SettleHero";
import { DebtsList } from "./settle/DebtsList";
import type { NetPosition, PairwiseDebt } from "~/lib/pairwise";

interface Props {
  eventId: string;
}

interface SettlePayload {
  event: {
    id: string;
    title: string;
    timezone: string;
    currency: string;
    monthlyEnabled: boolean;
    monthlyFeeCents: number | null;
    monthlyGamesCovered: number;
    dropInSurchargeCents: number;
    ownerId?: string | null;
  };
  extras: {
    potCents: number;
    currency: string;
    declarations: Array<{
      id: string;
      amountCents: number;
      currency: string;
      label: string;
      declaredBy: string;
      declaredAt: string;
    }>;
  };
  you?: {
    playerName: string;
    balanceCents: number;
    gamesOwed: number;
    streak: number;
    availableGameUnits: number;
    transactions: Array<{
      id: string;
      reason: string;
      direction: string;
      amountCents: number;
      currency: string;
      gameUnits: number;
      statusAfter: string | null;
      eventInstanceId: string | null;
      note: string | null;
      createdAt: string;
    }>;
    walletRunningTotal: number;
    activeSubscription: {
      id: string;
      mode: string;
      windowStart: string;
      windowEnd: string;
      feeCents: number;
      gamesCovered: number;
      status: string;
    } | null;
  };
  admin?: {
    balances: Array<{ playerName: string; amount: number; gamesOwed: number; streak: number }>;
    aggregate: { paidCount: number; totalCount: number };
    netPositions?: NetPosition[];
    pairwiseDebts?: PairwiseDebt[];
    subscriptions: Array<{
      id: string;
      userId: string;
      userName: string;
      mode: string;
      windowStart: string;
      windowEnd: string;
      feeCents: number;
      gamesCovered: number;
      status: string;
      createdAt: string;
    }>;
  };
}

function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(cents / 100);
}

export default function SettleUpPage({ eventId }: Props) {
  const t = useT();
  const [data, setData] = useState<SettlePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pmDialogOpen, setPmDialogOpen] = useState(false);
  const [pmCost, setPmCost] = useState<{ paymentMethods: string | null } | null>(null);
  const [pmEventUsers, setPmEventUsers] = useState<
    Array<{ id: string; name: string; role: "owner" | "admin" | "player" }>
  >([]);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/events/${eventId}/settle`);
      if (!res.ok) {
        if (res.status === 404) setError("Event not found.");
        else setError(`Failed to load (${res.status}).`);
        return;
      }
      setData(await res.json());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const openPaymentMethodDialog = () => {
    Promise.all([
      fetch(`/api/events/${eventId}/cost`).then((r) => (r.ok ? r.json() : null)),
      fetch(`/api/events/${eventId}/event-users`).then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([costData, usersData]) => {
        setPmCost(costData);
        setPmEventUsers(usersData?.users ?? []);
        setPmDialogOpen(true);
      })
      .catch(() => setPmDialogOpen(true));
  };

  if (loading) {
    return (
      <ThemeModeProvider>
        <ResponsiveLayout>
          <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", height: "60vh" }}>
            <CircularProgress />
          </Box>
        </ResponsiveLayout>
      </ThemeModeProvider>
    );
  }
  if (error || !data) {
    return (
      <ThemeModeProvider>
        <ResponsiveLayout>
          <Box sx={{ p: 4, maxWidth: 1100, mx: "auto" }}>
            <Stack spacing={2}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <IconButton href={`/events/${eventId}`} size="small" aria-label={t("backToGame")}>
                  <ArrowBackIcon />
                </IconButton>
              </Box>
              <Alert severity="error">{error ?? "Unknown error."}</Alert>
            </Stack>
          </Box>
        </ResponsiveLayout>
      </ThemeModeProvider>
    );
  }

  return (
    <ThemeModeProvider>
      <ResponsiveLayout>
        <Box sx={{ maxWidth: 1100, mx: "auto", p: { xs: 2, sm: 3 } }}>
          <Stack spacing={2}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <IconButton href={`/events/${eventId}`} size="small" aria-label={t("backToGame")}>
                <ArrowBackIcon />
              </IconButton>
            </Box>

            <SettleTab data={data} onChange={fetchData} onChangePaymentMethod={openPaymentMethodDialog} />
          </Stack>
        </Box>
      </ResponsiveLayout>
      <PaymentMethodOverrideDialog
        eventId={data.event.id}
        defaultMethods={pmCost?.paymentMethods ?? null}
        overrideMethods={null}
        canSetDefault={!!data.admin}
        eventUsers={pmEventUsers}
        mode="default"
        open={pmDialogOpen}
        onClose={() => setPmDialogOpen(false)}
        onSaved={() => { setPmDialogOpen(false); fetchData(); }}
      />
    </ThemeModeProvider>
  );
}

function SettleTab({
  data,
  onChange,
  onChangePaymentMethod,
}: {
  data: SettlePayload;
  onChange: () => void;
  onChangePaymentMethod: () => void;
}) {
  const t = useT();
  const [activeTab, setActiveTab] = useState<"transactions" | "debts">("debts");
  const [moreAnchor, setMoreAnchor] = useState<HTMLElement | null>(null);
  const [chartOpen, setChartOpen] = useState(false);
  const [settleBusy, setSettleBusy] = useState(false);
  const [settleFeedback, setSettleFeedback] = useState<
    { severity: "success" | "error" | "info"; message: string } | null
  >(null);

  const netPositions = data.admin?.netPositions ?? [];
  const pairwiseDebts = data.admin?.pairwiseDebts ?? [];
  const transactionsCount = data.you?.transactions.length ?? 0;
  const realMembersCount = netPositions.length > 0 ? netPositions.length : 2;
  const totalSpentCents = data.extras.potCents;

  const handleMarkSettled = async (debt: PairwiseDebt) => {
    // Authorization gate: owner/admin OR the creditor (the person the
    // money is owed to) can mark a debt as settled. The debtor themselves
    // cannot — that would let any player self-clear money they owe.
    const isCreditor = data.you?.playerName === debt.toName;
    if (!data.admin && !isCreditor) {
      setSettleFeedback({
        severity: "error",
        message: t("settleMarkSettledNoPermission") ??
          "Only the event owner or the creditor can mark this debt as settled.",
      });
      return;
    }
    setSettleBusy(true);
    setSettleFeedback(null);
    try {
      const res = await fetch(`/api/events/${data.event.id}/payments/historical/bulk`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ playerName: debt.fromName, creditorName: debt.toName }),
      });
      const body = await res.json().catch(() => ({} as { error?: string; settled?: number; skipped?: number; failed?: number }));
      if (!res.ok) {
        setSettleFeedback({
          severity: "error",
          message: body?.error ?? t("settleMarkSettledFailed") ?? `Failed (${res.status}).`,
        });
        return;
      }
      const settled = body?.settled ?? 0;
      const skipped = body?.skipped ?? 0;
      const failed = body?.failed ?? 0;
      if (settled > 0) {
        setSettleFeedback({
          severity: failed > 0 ? "info" : "success",
          message:
            t("settleMarkSettledSuccess")
              ?.replace("{name}", debt.fromName)
              ?.replace("{settled}", String(settled))
              ?.replace("{skipped}", String(skipped))
              ?.replace("{failed}", String(failed))
            ?? `Settled ${settled} payment(s) for ${debt.fromName}.`,
        });
      } else if (skipped > 0 && failed === 0) {
        // Already-settled (idempotent re-run).
        setSettleFeedback({
          severity: "info",
          message: t("settleMarkSettledAlready")
            ?.replace("{name}", debt.fromName)
            ?? `${debt.fromName}'s debts were already settled.`,
        });
      } else if (failed > 0) {
        setSettleFeedback({
          severity: "error",
          message:
            t("settleMarkSettledAllFailed")
              ?.replace("{name}", debt.fromName)
              ?.replace("{failed}", String(failed))
            ?? `Could not settle ${debt.fromName}'s debts (${failed} failed).`,
        });
      }
      // Refresh the data so the debt row disappears from the UI.
      await onChange();
    } catch (e) {
      setSettleFeedback({
        severity: "error",
        message: t("settleMarkSettledNetworkError") ?? String(e),
      });
    } finally {
      setSettleBusy(false);
    }
  };
  const handleRemind = (debt: PairwiseDebt) => {
    void fetch(`/api/events/${data.event.id}/payments/remind`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ playerName: debt.fromName }),
    });
  };
  const handleGenerateQr = (debt: PairwiseDebt) => {
    // QR code generation is a no-op stub for v1 — the design has it but we
    // don't yet have a backend route. A future ticket wires this up.
    void debt;
  };

  return (
    <Stack spacing={2}>
      <SettleHero
        event={{ id: data.event.id, title: data.event.title, currency: data.event.currency }}
        stats={{ transactions: transactionsCount, members: realMembersCount, totalSpentCents }}
        netPositions={netPositions}
        onShowCharts={() => setChartOpen((v) => !v)}
        onMore={(el) => setMoreAnchor(el)}
        onChangePaymentMethod={onChangePaymentMethod}
      />
      <Menu open={!!moreAnchor && !chartOpen} anchorEl={moreAnchor} onClose={() => setMoreAnchor(null)}>
        <MenuItem onClick={() => setMoreAnchor(null)}>
          <ListItemText>{t("settleHeroExportCsv") ?? "Export CSV"}</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => { setMoreAnchor(null); onChange(); }}>
          <ListItemText>{t("settleHeroRecompute") ?? "Recompute balances"}</ListItemText>
        </MenuItem>
      </Menu>

      {data.you && (
        <Paper sx={{ p: 2, borderRadius: 3 }}>
          <Typography variant="h6">You</Typography>
          <Typography variant="body2" color="text.secondary">
            {data.you.playerName}
          </Typography>
          <Stack direction="row" spacing={2} sx={{ mt: 1, flexWrap: "wrap" }}>
            <Chip
              label={t("settleYouBalance") ?? "Balance"}
              color={data.you.balanceCents > 0 ? "warning" : "success"}
              variant="outlined"
            />
            <Typography variant="body2" sx={{ alignSelf: "center" }}>
              {formatMoney(data.you.balanceCents, data.event.currency)}
            </Typography>
            <Chip
              label={(t("settleYouGameUnits") ?? "Game units") + ": " + data.you.availableGameUnits}
              variant="outlined"
            />
            <Chip
              label={(t("settleYouStreak") ?? "Streak") + ": " + data.you.streak}
              variant="outlined"
            />
          </Stack>
          {data.you.activeSubscription && (
            <Alert severity="info" sx={{ mt: 1 }}>
              {t("settleYouSubscribed") ?? "Subscribed"}: {data.you.activeSubscription.mode} ·{" "}
              {formatMoney(data.you.activeSubscription.feeCents, data.event.currency)} ·{" "}
              {data.you.activeSubscription.gamesCovered} games covered
            </Alert>
          )}
        </Paper>
      )}

      <Tabs
        value={activeTab}
        onChange={(_, v: typeof activeTab) => setActiveTab(v)}
        variant="scrollable"
        scrollButtons="auto"
      >
        <Tab value="transactions" label={t("settleTabTransactions") ?? "Transactions"} />
        <Tab value="debts" label={t("settleTabDebts") ?? "Debts"} data-testid="tab-debts" />
      </Tabs>

      {activeTab === "debts" && (
        <>
          {settleFeedback && (
            <Alert
              severity={settleFeedback.severity}
              onClose={() => setSettleFeedback(null)}
              data-testid="settle-feedback"
            >
              {settleFeedback.message}
            </Alert>
          )}
          <DebtsList
            debts={pairwiseDebts}
            currency={data.event.currency}
            onMarkSettled={handleMarkSettled}
            onRemind={handleRemind}
            onGenerateQr={handleGenerateQr}
          />
        </>
      )}

      {activeTab === "transactions" && (
        <Alert severity="info" data-testid="settle-transactions-hint">
          {t("settleTabTransactionsHint") ??
            "Detailed payments live in the game history for each game. Open a past game to see who paid what."}
        </Alert>
      )}
    </Stack>
  );
}
