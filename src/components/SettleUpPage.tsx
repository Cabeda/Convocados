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

            <SettleTab data={data} onChange={fetchData} />
            <PaymentMethodCard eventId={data.event.id} canSetDefault={!!data.admin} onChange={fetchData} />
            <ActivityTab data={data} />
            <ExtrasTab data={data} />
          </Stack>
        </Box>
      </ResponsiveLayout>
    </ThemeModeProvider>
  );
}

function SettleTab({ data, onChange }: { data: SettlePayload; onChange: () => void }) {
  const t = useT();
  const [activeTab, setActiveTab] = useState<"transactions" | "debts" | "members" | "permissions" | "activity">("debts");
  const [moreAnchor, setMoreAnchor] = useState<HTMLElement | null>(null);
  const [chartOpen, setChartOpen] = useState(false);
  const [extrasLabel, setExtrasLabel] = useState("");
  const [extrasAmount, setExtrasAmount] = useState("");
  const [extrasBusy, setExtrasBusy] = useState(false);
  const [extrasError, setExtrasError] = useState<string | null>(null);
  const [subUserId, setSubUserId] = useState("");
  const [settleBusy, setSettleBusy] = useState(false);
  const [settleFeedback, setSettleFeedback] = useState<
    { severity: "success" | "error" | "info"; message: string } | null
  >(null);
  const [subBusy, setSubBusy] = useState(false);

  const netPositions = data.admin?.netPositions ?? [];
  const pairwiseDebts = data.admin?.pairwiseDebts ?? [];
  const transactionsCount = data.you?.transactions.length ?? 0;
  const membersCount = 2; // placeholder — we don't have a per-event member count endpoint here; the API should expose it. For now derive from netPositions.
  const realMembersCount = netPositions.length > 0 ? netPositions.length : 2;
  const totalSpentCents = data.extras.potCents;

  const declare = async () => {
    setExtrasError(null);
    const amountCents = Math.round(parseFloat(extrasAmount) * 100);
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      setExtrasError("Enter a positive amount.");
      return;
    }
    if (!extrasLabel.trim()) {
      setExtrasError("Enter a label.");
      return;
    }
    setExtrasBusy(true);
    try {
      const res = await fetch(`/api/events/${data.event.id}/settle/extras`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amountCents, label: extrasLabel.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setExtrasError(body.error ?? `Failed (${res.status}).`);
        return;
      }
      setExtrasLabel("");
      setExtrasAmount("");
      onChange();
    } finally {
      setExtrasBusy(false);
    }
  };

  const subscribe = async () => {
    if (!subUserId.trim()) return;
    setSubBusy(true);
    try {
      await fetch(`/api/events/${data.event.id}/settle/subscriptions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: subUserId.trim() }),
      });
      setSubUserId("");
      onChange();
    } finally {
      setSubBusy(false);
    }
  };

  const cancelSub = async (id: string) => {
    await fetch(`/api/events/${data.event.id}/settle/subscriptions/${id}`, { method: "DELETE" });
    onChange();
  };

  const handleMarkSettled = async (debt: PairwiseDebt) => {
    if (!data.admin) {
      setSettleFeedback({
        severity: "error",
        message: t("settleMarkSettledNoPermission") ?? "Only the event owner can do this.",
      });
      return;
    }
    setSettleBusy(true);
    setSettleFeedback(null);
    try {
      const res = await fetch(`/api/events/${data.event.id}/payments/historical/bulk`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ playerName: debt.fromName }),
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
        <Tab value="members" label={t("settleTabMembers") ?? "Members"} />
        <Tab value="permissions" label={t("settleTabPermissions") ?? "Permissions"} />
        <Tab value="activity" label={t("settleTabRecentActivity") ?? "Recent activity"} />
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
        <Alert severity="info">
          {t("settleTabTransactionsHint") ?? "Detailed transactions live in the Payments tab on the event page."}
        </Alert>
      )}

      {activeTab === "members" && data.admin && (
        <Paper sx={{ p: 2, borderRadius: 3 }}>
          <Typography variant="h6">{t("settleAdminBalances") ?? "Outstanding balances"}</Typography>
          {data.admin.balances.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {t("settleAdminNoDebts") ?? "Nobody owes anything."}
            </Typography>
          ) : (
            <Table size="small" sx={{ mt: 1 }}>
              <TableHead>
                <TableRow>
                  <TableCell>Player</TableCell>
                  <TableCell align="right">Owed</TableCell>
                  <TableCell align="right">Games</TableCell>
                  <TableCell align="right">Streak</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.admin.balances.map((b) => (
                  <TableRow key={b.playerName}>
                    <TableCell>{b.playerName}</TableCell>
                    <TableCell align="right">{formatMoney(Math.round(b.amount * 100), data.event.currency)}</TableCell>
                    <TableCell align="right">{b.gamesOwed}</TableCell>
                    <TableCell align="right">{b.streak}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Paper>
      )}

      {activeTab === "members" && !data.admin && (
        <Alert severity="info">{t("settleActivityLoginRequired") ?? "Log in to see members."}</Alert>
      )}

      {activeTab === "permissions" && data.admin && (
        <>
          {data.event.monthlyEnabled && (
            <Paper sx={{ p: 2, borderRadius: 3 }}>
              <Typography variant="h6">{t("settleAdminSubscriptions") ?? "Monthly subscriptions"}</Typography>
              <Stack direction="row" spacing={1} sx={{ mt: 1, mb: 1 }}>
                <TextField
                  size="small"
                  label="User ID"
                  value={subUserId}
                  onChange={(e) => setSubUserId(e.target.value)}
                />
                <Button variant="contained" onClick={subscribe} disabled={subBusy || !subUserId.trim()}>
                  {t("settleAdminSubscribe") ?? "Subscribe"}
                </Button>
              </Stack>
              {data.admin.subscriptions.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  {t("settleAdminNoSubs") ?? "No active subscriptions."}
                </Typography>
              ) : (
                <Stack spacing={1}>
                  {data.admin.subscriptions.map((s) => (
                    <Box
                      key={s.id}
                      sx={{
                        display: "flex", alignItems: "center", gap: 1,
                        p: 1, borderRadius: 2,
                        bgcolor: (theme) => theme.palette.action.hover,
                      }}
                    >
                      <Typography sx={{ flex: 1 }}>
                        <strong>{s.userName}</strong> · {formatMoney(s.feeCents, data.event.currency)} ·{" "}
                        {s.gamesCovered} games
                      </Typography>
                      <Chip label={s.status} size="small" color={s.status === "active" ? "success" : "default"} />
                      <IconButton size="small" onClick={() => cancelSub(s.id)} aria-label="cancel">
                        <CloseIcon fontSize="small" />
                      </IconButton>
                    </Box>
                  ))}
                </Stack>
              )}
            </Paper>
          )}

          <Paper sx={{ p: 2, borderRadius: 3 }}>
            <Typography variant="h6">{t("settleAdminDeclareSpend") ?? "Declare a spend from the pot"}</Typography>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ mt: 1 }}>
              <TextField
                size="small" label="Label (e.g. Apple Developer fee)"
                value={extrasLabel}
                onChange={(e) => setExtrasLabel(e.target.value)}
                sx={{ flex: 1 }}
              />
              <TextField
                size="small" label="Amount" type="number"
                value={extrasAmount}
                onChange={(e) => setExtrasAmount(e.target.value)}
                slotProps={{ htmlInput: { step: "0.01", min: "0" } }}
                sx={{ width: 120 }}
              />
              <Button variant="contained" onClick={declare} disabled={extrasBusy}>
                {t("settleAdminDeclare") ?? "Declare"}
              </Button>
            </Stack>
            {extrasError && <Alert severity="error" sx={{ mt: 1 }}>{extrasError}</Alert>}
          </Paper>
        </>
      )}

      {activeTab === "permissions" && !data.admin && (
        <Alert severity="info">{t("settleActivityLoginRequired") ?? "Log in to manage permissions."}</Alert>
      )}

      {activeTab === "activity" && (
        <Alert severity="info">
          {t("settleActivityLoginRequired") ?? "Recent activity shows up after the next game."}
        </Alert>
      )}
    </Stack>
  );
}

function ActivityTab({ data }: { data: SettlePayload }) {
  const t = useT();
  if (!data.you) {
    return <Alert severity="info">{t("settleActivityLoginRequired") ?? "Log in to see your activity."}</Alert>;
  }
  if (data.you.transactions.length === 0) {
    return <Alert severity="info">{t("settleActivityEmpty") ?? "No transactions yet."}</Alert>;
  }
  return (
    <Paper sx={{ p: 2, borderRadius: 3 }}>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Date</TableCell>
            <TableCell>Reason</TableCell>
            <TableCell align="right">Amount</TableCell>
            <TableCell align="right">Game units</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {data.you.transactions.map((tx) => (
            <TableRow key={tx.id}>
              <TableCell>{new Date(tx.createdAt).toLocaleString()}</TableCell>
              <TableCell>
                <Chip label={tx.reason} size="small" />
                {tx.statusAfter && (
                  <Chip label={tx.statusAfter} size="small" sx={{ ml: 0.5 }} />
                )}
              </TableCell>
              <TableCell align="right">{formatMoney(tx.amountCents, tx.currency)}</TableCell>
              <TableCell align="right">{tx.gameUnits > 0 ? `+${tx.gameUnits}` : tx.gameUnits || ""}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Paper>
  );
}

function ExtrasTab({ data }: { data: SettlePayload }) {
  const t = useT();
  return (
    <Stack spacing={2}>
      <Paper sx={{ p: 2, borderRadius: 3 }}>
        <Typography variant="overline" color="text.secondary">
          {t("settleExtrasCurrentPot") ?? "Extras pot"}
        </Typography>
        <Typography variant="h3" fontWeight={700} sx={{ mt: 0.5 }}>
          {formatMoney(data.extras.potCents, data.extras.currency)}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {t("settleExtrasExplanation") ??
            "Forfeited Game Units from expired credits. Visible to everyone in the group."}
        </Typography>
      </Paper>

      <Paper sx={{ p: 2, borderRadius: 3 }}>
        <Typography variant="h6">{t("settleExtrasSpendingLog") ?? "Spending log"}</Typography>
        <Divider sx={{ my: 1 }} />
        {data.extras.declarations.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {t("settleExtrasNoDeclarations") ?? "No spends declared yet."}
          </Typography>
        ) : (
          <Stack spacing={1}>
            {data.extras.declarations.map((d) => (
              <Box
                key={d.id}
                sx={{
                  display: "flex", alignItems: "center", gap: 1,
                  p: 1, borderRadius: 2,
                  bgcolor: (theme) => theme.palette.action.hover,
                }}
              >
                <Typography sx={{ flex: 1 }}>
                  <strong>{d.label}</strong> · {new Date(d.declaredAt).toLocaleDateString()}
                </Typography>
                <Typography color="error.main" fontWeight={600}>
                  −{formatMoney(d.amountCents, d.currency)}
                </Typography>
              </Box>
            ))}
          </Stack>
        )}
      </Paper>
    </Stack>
  );
}

/**
 * Embeds the PaymentMethodOverrideDialog in the Status tab. Previously the
 * dialog existed but had no trigger, so the "change method" control was
 * effectively invisible (ADR 0020 fix).
 */
function PaymentMethodCard({ eventId, canSetDefault, onChange }: { eventId: string; canSetDefault: boolean; onChange: () => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [cost, setCost] = useState<{ paymentMethods: string | null; tempPaymentMethods: string | null } | null>(null);
  const [eventUsers, setEventUsers] = useState<
    Array<{ id: string; name: string; role: "owner" | "admin" | "player" }>
  >([]);

  const openDialog = () => {
    Promise.all([
      fetch(`/api/events/${eventId}/cost`).then((r) => (r.ok ? r.json() : null)),
      fetch(`/api/events/${eventId}/event-users`).then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([costData, usersData]) => {
        setCost(costData);
        setEventUsers(usersData?.users ?? []);
        setOpen(true);
      })
      .catch(() => setOpen(true));
  };

  return (
    <Paper sx={{ p: 2, borderRadius: 3 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <Typography variant="h6" sx={{ flex: 1 }}>{t("settlePaymentsMethodTitle") ?? "Payment method"}</Typography>
        <Button variant="outlined" size="small" onClick={openDialog}>
          {t("settlePaymentsMethodChange") ?? "Change method"}
        </Button>
      </Box>
      <PaymentMethodOverrideDialog
        eventId={eventId}
        defaultMethods={cost?.paymentMethods ?? null}
        overrideMethods={cost?.tempPaymentMethods ?? null}
        canSetDefault={canSetDefault}
        eventUsers={eventUsers}
        open={open}
        onClose={() => setOpen(false)}
        onSaved={() => { setOpen(false); onChange(); }}
      />
    </Paper>
  );
}
