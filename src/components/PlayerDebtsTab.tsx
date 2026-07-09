/* eslint-disable react-hooks/set-state-in-effect -- Sync-from-server pattern: server data initializes local state, async fetch responses set state. */
import React, { useEffect, useState, useCallback } from "react";
import {
  Box, Paper, Stack, Typography, Alert, Chip,
  Table, TableBody, TableCell, TableHead, TableRow, Button,
  CircularProgress, IconButton, Tooltip,
  Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions,
} from "@mui/material";
import NotificationsIcon from "@mui/icons-material/Notifications";
import CheckIcon from "@mui/icons-material/Check";
import { useT } from "~/lib/useT";

interface MatrixPayload {
  source: "ledger" | "legacy";
  event: { id: string; title: string; currency: string };
  players: string[];
  games: Array<{
    gameHistoryId: string;
    dateTime: string;
    totalAmount: number;
    currency: string;
    cells: Record<string, { status: string; amountCents: number; settled: boolean; settledAt: string | null }>;
  }>;
}

function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(cents / 100);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: "2-digit", month: "short" });
}

export function PlayerDebtsTab({ eventId, onChange }: { eventId: string; onChange?: () => void }) {
  const t = useT();
  const [data, setData] = useState<MatrixPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmBulk, setConfirmBulk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/events/${eventId}/payments/all`);
      if (!res.ok) {
        setError(`Failed to load (${res.status}).`);
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

  const remind = async (playerName: string) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/events/${eventId}/payments/remind`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ playerName }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `Failed (${res.status}).`);
      }
    } finally {
      setBusy(false);
    }
  };

  const settleAll = async (playerName: string) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/events/${eventId}/payments/historical/bulk`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ playerName }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `Failed (${res.status}).`);
        return;
      }
      await fetchData();
      onChange?.();
    } finally {
      setBusy(false);
      setConfirmBulk(null);
    }
  };

  if (loading) {
    return (
      <Box sx={{ p: 4, display: "flex", justifyContent: "center" }}>
        <CircularProgress />
      </Box>
    );
  }
  if (error || !data) {
    return <Alert severity="error">{error ?? "Unknown error."}</Alert>;
  }

  // Aggregate per player: list of unpaid games + total
  const currency = data.event.currency;
  const playerDebts: Array<{ player: string; games: Array<{ gameHistoryId: string; dateTime: string; amountCents: number }>; totalCents: number }> = [];
  for (const player of data.players) {
    const unpaidGames: Array<{ gameHistoryId: string; dateTime: string; amountCents: number }> = [];
    let totalCents = 0;
    for (const g of data.games) {
      const cell = g.cells[player];
      if (!cell || cell.status === "absent") continue;
      if (cell.settled || cell.status === "paid") continue;
      if (cell.status === "pending" || cell.status === "sent") {
        unpaidGames.push({ gameHistoryId: g.gameHistoryId, dateTime: g.dateTime, amountCents: cell.amountCents });
        totalCents += cell.amountCents;
      }
    }
    if (unpaidGames.length > 0) {
      playerDebts.push({ player, games: unpaidGames, totalCents });
    }
  }

  if (playerDebts.length === 0) {
    return (
      <Alert severity="success">
        {t("playerDebtsAllClear") ?? "No outstanding debts. Everyone is paid up. 🎉"}
      </Alert>
    );
  }

  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">
        {t("playerDebtsIntro")?.replace("{n}", String(playerDebts.length))
          ?? `${playerDebts.length} player(s) with outstanding debts`}
      </Typography>

      {playerDebts.map((d) => (
        <Paper key={d.player} sx={{ p: 2, borderRadius: 3 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1, flexWrap: "wrap" }}>
            <Typography variant="h6" sx={{ flex: 1 }}>{d.player}</Typography>
            <Chip
              label={formatMoney(d.totalCents, currency)}
              color="warning"
              variant="outlined"
            />
            <Tooltip title={t("playerDebtsRemindAction") ?? "Send payment reminder"}>
              <span>
                <IconButton size="small" onClick={() => remind(d.player)} disabled={busy}>
                  <NotificationsIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Button
              size="small"
              variant="contained"
              color="success"
              startIcon={<CheckIcon />}
              disabled={busy}
              onClick={() => setConfirmBulk(d.player)}
            >
              {t("playerDebtsMarkAllPaid") ?? "Mark all paid"}
            </Button>
          </Box>

          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t("playerDebtsGameHeader") ?? "Game"}</TableCell>
                <TableCell align="right">{t("playerDebtsAmountHeader") ?? "Amount"}</TableCell>
                <TableCell>{t("playerDebtsStatusHeader") ?? "Status"}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {d.games.map((g) => (
                <TableRow key={g.gameHistoryId}>
                  <TableCell>{formatDate(g.dateTime)}</TableCell>
                  <TableCell align="right">{formatMoney(g.amountCents, currency)}</TableCell>
                  <TableCell>
                    <Chip label={t("playerDebtsPending") ?? "pending"} size="small" color="warning" variant="outlined" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      ))}

      <Dialog open={!!confirmBulk} onClose={() => setConfirmBulk(null)}>
        <DialogTitle>{t("playerDebtsBulkTitle") ?? "Mark all debts as settled?"}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {confirmBulk && (
              <>
                {t("playerDebtsBulkBody")?.replace("{player}", confirmBulk)
                  ?? `Mark all of ${confirmBulk}'s outstanding historical payments as paid?`}
              </>
            )}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmBulk(null)}>{t("cancel")}</Button>
          <Button
            onClick={() => confirmBulk && settleAll(confirmBulk)}
            color="success"
            variant="contained"
            startIcon={<CheckIcon />}
            disabled={busy}
          >
            {t("playerDebtsMarkAllPaid") ?? "Mark all paid"}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
