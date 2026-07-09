/* eslint-disable react-hooks/set-state-in-effect -- Sync-from-server pattern: server data initializes local state, async fetch responses set state. Common in this codebase. */
import React, { useEffect, useState, useCallback } from "react";
import {
  Box, Paper, Stack, Tabs, Tab, Typography, Alert, Chip,
  Table, TableBody, TableCell, TableHead, TableRow, TextField, Button,
  CircularProgress, alpha, IconButton, Divider,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import ReceiptIcon from "@mui/icons-material/Receipt";
import HistoryIcon from "@mui/icons-material/History";
import AccountBalanceWalletIcon from "@mui/icons-material/AccountBalanceWallet";
import GridOnIcon from "@mui/icons-material/GridOn";
import { useT } from "~/lib/useT";
import { PaymentsMatrixTab } from "./PaymentsMatrixTab";
import { PlayerDebtsTab } from "./PlayerDebtsTab";

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
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
  }).format(cents / 100);
}

export function SettleUpPage({ eventId }: Props) {
  const t = useT();
  const [tab, setTab] = useState(0);
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
      <Box sx={{ p: 4, display: "flex", justifyContent: "center" }}>
        <CircularProgress />
      </Box>
    );
  }
  if (error || !data) {
    return (
      <Box sx={{ p: 4 }}>
        <Alert severity="error">{error ?? "Unknown error."}</Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ maxWidth: 1100, mx: "auto", p: { xs: 2, sm: 3 } }}>
      <Stack spacing={2}>
        <Box>
          <Typography variant="h4" fontWeight={700}>
            {t("settleUpTitle") ?? "Settle Up"}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {data.event.title}
          </Typography>
        </Box>

        <Paper sx={{ borderRadius: 3 }}>
          <Tabs
            value={tab}
            onChange={(_, v) => setTab(v)}
            variant="scrollable"
            scrollButtons="auto"
          >
            <Tab icon={<ReceiptIcon />} iconPosition="start" label={t("settleTabSettle") ?? "Settle"} />
            <Tab icon={<HistoryIcon />} iconPosition="start" label={t("settleTabActivity") ?? "Your activity"} />
            <Tab icon={<AccountBalanceWalletIcon />} iconPosition="start" label={t("settleTabExtras") ?? "Extras"} />
            {data.admin && (
              <Tab icon={<GridOnIcon />} iconPosition="start" label={t("settleTabPayments") ?? "Payments"} />
            )}
          </Tabs>
        </Paper>

        {tab === 0 && <SettleTab data={data} onChange={fetchData} />}
        {tab === 1 && <ActivityTab data={data} />}
        {tab === 2 && <ExtrasTab data={data} onChange={fetchData} />}
        {tab === 3 && data.admin && <PaymentsSubTabs eventId={data.event.id} onChange={fetchData} />}
      </Stack>
    </Box>
  );
}

function PaymentsSubTabs({ eventId, onChange }: { eventId: string; onChange: () => void }) {
  const t = useT();
  const [sub, setSub] = useState(0);
  return (
    <Stack spacing={2}>
      <Paper sx={{ borderRadius: 3 }}>
        <Tabs value={sub} onChange={(_, v) => setSub(v)} variant="fullWidth">
          <Tab label={t("paymentsMatrixTitle") ?? "By game"} />
          <Tab label={t("playerDebtsTitle") ?? "By player"} />
        </Tabs>
      </Paper>
      {sub === 0 && <PaymentsMatrixTab eventId={eventId} onChange={onChange} />}
      {sub === 1 && <PlayerDebtsTab eventId={eventId} onChange={onChange} />}
    </Stack>
  );
}

function SettleTab({ data, onChange }: { data: SettlePayload; onChange: () => void }) {
  const t = useT();
  const [extrasLabel, setExtrasLabel] = useState("");
  const [extrasAmount, setExtrasAmount] = useState("");
  const [extrasBusy, setExtrasBusy] = useState(false);
  const [extrasError, setExtrasError] = useState<string | null>(null);
  const [subUserId, setSubUserId] = useState("");
  const [subBusy, setSubBusy] = useState(false);

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

  return (
    <Stack spacing={2}>
      {data.you && (
        <Paper sx={{ p: 2, borderRadius: 3 }}>
          <Typography variant="h6">You</Typography>
          <Typography variant="body2" color="text.secondary">
            {data.you.playerName}
          </Typography>
          <Stack direction="row" spacing={2} sx={{ mt: 1 }}>
            <Chip
              label={t("settleYouBalance") ?? "Balance"}
              color={data.you.balanceCents > 0 ? "warning" : "success"}
              variant="outlined"
            />
            <Typography variant="body2">
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
              {t("settleYouSubscribed") ?? "Subscribed"}: {data.you.activeSubscription.mode} ·
              {" "}{formatMoney(data.you.activeSubscription.feeCents, data.event.currency)} ·
              {" "}{data.you.activeSubscription.gamesCovered} games covered
            </Alert>
          )}
        </Paper>
      )}

      {data.admin && (
        <>
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
                        bgcolor: (t) => alpha(t.palette.primary.main, 0.05),
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

function ExtrasTab({ data }: { data: SettlePayload; onChange: () => void }) {
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
                  bgcolor: (t) => alpha(t.palette.info.main, 0.05),
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
