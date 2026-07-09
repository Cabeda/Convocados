/* eslint-disable react-hooks/set-state-in-effect -- Sync-from-server pattern: server data initializes local state, async fetch responses set state. */
import React, { useEffect, useState, useCallback } from "react";
import {
  Box, Paper, Stack, Typography, Alert, Chip,
  Table, TableBody, TableCell, TableHead, TableRow, Button,
  CircularProgress, Tooltip,
  Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions,
} from "@mui/material";
import CheckIcon from "@mui/icons-material/Check";
import { useT } from "~/lib/useT";

interface MatrixCell {
  status: "paid" | "sent" | "pending" | "absent";
  amountCents: number;
  gameHistoryId: string;
  settled: boolean;
  settledAt: string | null;
}

interface MatrixPayload {
  source: "ledger" | "legacy";
  event: { id: string; title: string; currency: string };
  players: string[];
  games: Array<{
    gameHistoryId: string;
    dateTime: string;
    totalAmount: number;
    currency: string;
    cells: Record<string, MatrixCell>;
  }>;
}

function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
  }).format(cents / 100);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: "2-digit", month: "short" });
}

export function PaymentsMatrixTab({ eventId, onChange }: { eventId: string; onChange?: () => void }) {
  const t = useT();
  const [data, setData] = useState<MatrixPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmSettle, setConfirmSettle] = useState<{ gameHistoryId: string; playerName: string } | null>(null);
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

  const settle = async (gameHistoryId: string, playerName: string) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/events/${eventId}/payments/historical`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ gameHistoryId, playerName }),
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
      setConfirmSettle(null);
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
  if (data.games.length === 0) {
    return (
      <Alert severity="info">
        {t("paymentsMatrixNoGames") ?? "No played games yet. The matrix will populate after the first game is played."}
      </Alert>
    );
  }

  const sourceLabel = data.source === "ledger" ? "🟢 ledger" : "🟡 legacy";
  const currency = data.event.currency;

  return (
    <Stack spacing={2}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <Typography variant="body2" color="text.secondary">
          {t("paymentsMatrixSource") ?? "Source"}: {sourceLabel}
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Chip
          size="small"
          label={t("paymentsMatrixTotalGames")?.replace("{n}", String(data.games.length)) ?? `${data.games.length} games`}
          variant="outlined"
        />
        <Chip
          size="small"
          label={t("paymentsMatrixTotalPlayers")?.replace("{n}", String(data.players.length)) ?? `${data.players.length} players`}
          variant="outlined"
        />
      </Box>

      <Paper sx={{ borderRadius: 3, overflow: "auto" }}>
        <Table size="small" sx={{ minWidth: 600 }}>
          <TableHead>
            <TableRow>
              <TableCell sx={{ position: "sticky", left: 0, backgroundColor: (t) => t.palette.background.paper, fontWeight: 700 }}>
                {t("paymentsMatrixPlayerHeader") ?? "Player"}
              </TableCell>
              {data.games.map((g) => (
                <TableCell key={g.gameHistoryId} align="center" sx={{ fontWeight: 700 }}>
                  <Tooltip title={new Date(g.dateTime).toLocaleString()}>
                    <span>{formatDate(g.dateTime)}</span>
                  </Tooltip>
                  <Typography variant="caption" display="block" color="text.secondary">
                    {formatMoney(g.totalAmount * 100, currency)}
                  </Typography>
                </TableCell>
              ))}
              <TableCell align="right" sx={{ fontWeight: 700 }}>
                {t("paymentsMatrixTotalHeader") ?? "Total"}
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {data.players.map((player) => {
              let owedCents = 0;
              let owedCount = 0;
              return (
                <TableRow key={player}>
                  <TableCell sx={{ position: "sticky", left: 0, backgroundColor: (t) => t.palette.background.paper, fontWeight: 600 }}>
                    {player}
                  </TableCell>
                  {data.games.map((g) => {
                    const cell = g.cells[player];
                    if (!cell) {
                      return <TableCell key={g.gameHistoryId} align="center">—</TableCell>;
                    }
                    if (cell.status === "absent") {
                      return <TableCell key={g.gameHistoryId} align="center" sx={{ color: "text.disabled" }}>—</TableCell>;
                    }
                    if (cell.settled) {
                      return (
                        <TableCell key={g.gameHistoryId} align="center">
                          <Tooltip title={cell.settledAt ? new Date(cell.settledAt).toLocaleString() : ""}>
                            <Chip label="✓" size="small" color="success" />
                          </Tooltip>
                        </TableCell>
                      );
                    }
                    if (cell.status === "pending" || cell.status === "sent") {
                      owedCents += cell.amountCents;
                      owedCount++;
                      return (
                        <TableCell key={g.gameHistoryId} align="center">
                          <Tooltip title={cell.status === "sent" ? "Sent (unconfirmed)" : "Pending"}>
                            <Button
                              size="small"
                              variant="outlined"
                              color="warning"
                              disabled={busy}
                              onClick={() => setConfirmSettle({ gameHistoryId: g.gameHistoryId, playerName: player })}
                              sx={{ minWidth: 60, fontSize: "0.7rem" }}
                            >
                              {formatMoney(cell.amountCents, currency)}
                            </Button>
                          </Tooltip>
                        </TableCell>
                      );
                    }
                    return <TableCell key={g.gameHistoryId} align="center">✓</TableCell>;
                  })}
                  <TableCell align="right" sx={{ fontWeight: 700, color: owedCents > 0 ? "warning.main" : "success.main" }}>
                    {owedCount > 0 ? formatMoney(owedCents, currency) : "—"}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Paper>

      <Dialog open={!!confirmSettle} onClose={() => setConfirmSettle(null)}>
        <DialogTitle>{t("paymentsMatrixSettleTitle") ?? "Mark as paid?"}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {confirmSettle && (
              <>
                {t("paymentsMatrixSettleBody")?.replace("{player}", confirmSettle.playerName)
                  ?? `Mark ${confirmSettle.playerName}'s payment for this game as paid?`}
              </>
            )}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmSettle(null)}>{t("cancel")}</Button>
          <Button
            onClick={() => { if (confirmSettle) { void settle(confirmSettle.gameHistoryId, confirmSettle.playerName); } }}
            color="success"
            variant="contained"
            startIcon={<CheckIcon />}
            disabled={busy}
          >
            {t("paymentsMatrixSettleConfirm") ?? "Mark paid"}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
