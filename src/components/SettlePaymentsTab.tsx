/* eslint-disable react-hooks/set-state-in-effect -- Sync-from-server pattern: server data initializes local state, async fetch responses set state. Common in this codebase. */
import React, { useEffect, useState, useCallback } from "react";
import {
  Box, Paper, Stack, Typography, Alert, Chip,
  Table, TableBody, TableCell, TableHead, TableRow, Button,
  CircularProgress, IconButton, Tooltip, MenuItem, Divider,
  Dialog, DialogTitle, DialogContent, DialogActions,
  Select, FormControl, InputLabel, alpha,
} from "@mui/material";
import CheckIcon from "@mui/icons-material/Check";
import NotificationsIcon from "@mui/icons-material/Notifications";
import { useT } from "~/lib/useT";

interface MatrixCell {
  status: "paid" | "sent" | "pending" | "absent";
  amountCents: number;
  gameHistoryId: string;
  settled: boolean;
  settledAt: string | null;
  payerUserId: string | null;
  payerName: string | null;
  paidToUserId: string | null;
  paidToName: string | null;
}

interface MatrixGame {
  gameHistoryId: string;
  dateTime: string;
  totalAmount: number;
  currency: string;
  cells: Record<string, MatrixCell>;
}

interface MatrixPayload {
  source: "ledger" | "legacy";
  event: { id: string; title: string; currency: string };
  players: string[];
  games: MatrixGame[];
}

interface EventUser {
  id: string;
  name: string;
}

function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(cents / 100);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

interface SettleDialogState {
  gameHistoryId: string;
  debtorName: string;
  debtorUserId: string;
  amountCents: number;
}

interface BulkSettleDialogState {
  debtorName: string;
  debtorUserId: string;
  totalAmountCents: number;
  gameCount: number;
}

interface SettlePaymentsTabProps {
  eventId: string;
  eventUsers: EventUser[];
  onChange?: () => void;
}

export function SettlePaymentsTab({ eventId, eventUsers, onChange }: SettlePaymentsTabProps) {
  const t = useT();
  const [data, setData] = useState<MatrixPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState<SettleDialogState | null>(null);
  const [bulkDialog, setBulkDialog] = useState<BulkSettleDialogState | null>(null);
  const [busy, setBusy] = useState(false);

  // Form state for the single-game settle dialog
  const [payMethod, setPayMethod] = useState("cash");
  const [payerUserId, setPayerUserId] = useState<string>("");
  const [paidToUserId, setPaidToUserId] = useState<string>("");

  // Form state for the bulk settle dialog
  const [bulkPayMethod, setBulkPayMethod] = useState("cash");
  const [bulkPayerUserId, setBulkPayerUserId] = useState<string>("");
  const [bulkPaidToUserId, setBulkPaidToUserId] = useState<string>("");

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

  const settleOne = async (state: SettleDialogState) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/events/${eventId}/payments/historical`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          gameHistoryId: state.gameHistoryId,
          playerName: state.debtorName,
          payerUserId: payerUserId || null,
          paidToUserId: paidToUserId || null,
          method: payMethod,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `Failed (${res.status}).`);
        return;
      }
      await fetchData();
      onChange?.();
      setDialog(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const settleBulk = async (state: BulkSettleDialogState) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/events/${eventId}/payments/historical/bulk`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          playerName: state.debtorName,
          payerUserId: bulkPayerUserId || null,
          paidToUserId: bulkPaidToUserId || null,
          method: bulkPayMethod,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `Failed (${res.status}).`);
        return;
      }
      await fetchData();
      onChange?.();
      setBulkDialog(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const remind = async (playerName: string) => {
    setError(null);
    try {
      await fetch(`/api/events/${eventId}/payments/remind`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ playerName }),
      });
    } catch (e) {
      setError(String(e));
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

  // Build the per-game outstanding view. For each game, list the players
  // who are still pending and the total outstanding. The matrix on the
  // right is a dense grid for spotting trends.
  const userByName = new Map(eventUsers.map((u) => [u.name, u]));

  const perGameOutstanding: Array<{
    game: MatrixGame;
    pending: Array<{ name: string; cell: MatrixCell; userId: string | null }>;
    totalCents: number;
  }> = [];
  for (const g of data.games) {
    const pending: Array<{ name: string; cell: MatrixCell; userId: string | null }> = [];
    let totalCents = 0;
    for (const name of data.players) {
      const cell = g.cells[name];
      if (!cell) continue;
      if (cell.status === "absent") continue;
      if (cell.settled || cell.status === "paid") continue;
      if (cell.status === "pending" || cell.status === "sent") {
        pending.push({ name, cell, userId: userByName.get(name)?.id ?? null });
        totalCents += cell.amountCents;
      }
    }
    perGameOutstanding.push({ game: g, pending, totalCents });
  }

  // Per-player outstanding across all games
  const perPlayerOutstanding = new Map<string, { totalCents: number; games: number }>();
  for (const entry of perGameOutstanding) {
    for (const p of entry.pending) {
      const cur = perPlayerOutstanding.get(p.name) ?? { totalCents: 0, games: 0 };
      cur.totalCents += p.cell.amountCents;
      cur.games++;
      perPlayerOutstanding.set(p.name, cur);
    }
  }

  const totalOutstandingCents = [...perPlayerOutstanding.values()].reduce((s, v) => s + v.totalCents, 0);
  const totalOutstandingGames = [...perPlayerOutstanding.values()].reduce((s, v) => s + v.games, 0);
  const playerCount = perPlayerOutstanding.size;
  const currency = data.event.currency;

  return (
    <Stack spacing={3}>
      {/* Summary */}
      <Paper sx={{ p: 2, borderRadius: 3 }}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems={{ sm: "center" }}>
          <Box sx={{ flex: 1 }}>
            <Typography variant="overline" color="text.secondary">
              {t("settleOutstandingTotal") ?? "Total outstanding"}
            </Typography>
            <Typography variant="h4" fontWeight={700}>
              {formatMoney(totalOutstandingCents, currency)}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t("settleOutstandingSummary")?.replace("{games}", String(totalOutstandingGames)).replace("{players}", String(playerCount))
                ?? `${totalOutstandingGames} pending payment(s) across ${playerCount} player(s)`}
            </Typography>
          </Box>
          <Stack direction="row" spacing={1}>
            <Chip
              size="small"
              label={`${t("settleSourceLabel") ?? "Source"}: ${data.source === "ledger" ? "🟢 ledger" : "🟡 legacy"}`}
              variant="outlined"
            />
            <Chip
              size="small"
              label={`${data.games.length} ${t("settleGamesLabel") ?? "games"}`}
              variant="outlined"
            />
            <Chip
              size="small"
              label={`${data.players.length} ${t("settlePlayersLabel") ?? "players"}`}
              variant="outlined"
            />
          </Stack>
        </Stack>
      </Paper>

      {/* Outstanding by game (the revamped UX) */}
      {perGameOutstanding.every((g) => g.pending.length === 0) ? (
        <Alert severity="success">
          {t("settleAllClear") ?? "All caught up. No outstanding payments across any game."}
        </Alert>
      ) : (
        perGameOutstanding.filter((g) => g.pending.length > 0).map((entry) => {
          const { game, pending, totalCents } = entry;
          return (
            <Paper key={game.gameHistoryId} sx={{ p: 2, borderRadius: 3 }}>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ sm: "center" }} sx={{ mb: 1 }}>
                <Box sx={{ flex: 1 }}>
                  <Typography variant="subtitle1" fontWeight={700}>
                    {formatDate(game.dateTime)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {pending.length} {t("settleMissingPlayers") ?? "missing player(s)"} · {formatMoney(totalCents, currency)}
                  </Typography>
                </Box>
              </Stack>
              <Divider sx={{ mb: 1 }} />
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{t("settlePlayerHeader") ?? "Player"}</TableCell>
                    <TableCell align="right">{t("settleAmountHeader") ?? "Amount"}</TableCell>
                    <TableCell>{t("settleStatusHeader") ?? "Status"}</TableCell>
                    <TableCell align="right">{t("settleActionsHeader") ?? "Actions"}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {pending.map((p) => (
                    <TableRow key={p.name}>
                      <TableCell>{p.name}</TableCell>
                      <TableCell align="right">{formatMoney(p.cell.amountCents, currency)}</TableCell>
                      <TableCell>
                        <Chip
                          label={p.cell.status === "sent" ? (t("settleStatusSent") ?? "sent") : (t("settleStatusPending") ?? "pending")}
                          size="small"
                          color="warning"
                          variant="outlined"
                        />
                      </TableCell>
                      <TableCell align="right">
                        <Button
                          size="small"
                          variant="contained"
                          color="success"
                          startIcon={<CheckIcon />}
                          disabled={busy}
                          onClick={() => {
                            setDialog({
                              gameHistoryId: game.gameHistoryId,
                              debtorName: p.name,
                              debtorUserId: p.userId ?? "",
                              amountCents: p.cell.amountCents,
                            });
                            // Defaults: payer = the debtor, paidTo = blank (the API falls back to owner)
                            setPayerUserId(p.userId ?? "");
                            setPaidToUserId("");
                            setPayMethod("cash");
                            setError(null);
                          }}
                        >
                          {t("settleMarkPaid") ?? "Mark paid"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Paper>
          );
        })
      )}

      {/* Per-player summary (the bulk settle entry point) */}
      {perPlayerOutstanding.size > 0 && (
        <Paper sx={{ p: 2, borderRadius: 3 }}>
          <Typography variant="h6" sx={{ mb: 1 }}>
            {t("settleBulkTitle") ?? "Settle all debts for a player"}
          </Typography>
          <Stack spacing={1}>
            {[...perPlayerOutstanding.entries()].sort((a, b) => b[1].totalCents - a[1].totalCents).map(([name, info]) => {
              const u = userByName.get(name);
              return (
                <Stack
                  key={name}
                  direction="row"
                  spacing={1}
                  alignItems="center"
                  sx={{ p: 1, borderRadius: 2, bgcolor: (t) => alpha(t.palette.warning.main, 0.05) }}
                >
                  <Typography sx={{ flex: 1 }} fontWeight={600}>{name}</Typography>
                  <Chip
                    label={`${formatMoney(info.totalCents, currency)} · ${info.games} ${t("settleGamesLabel") ?? "games"}`}
                    size="small"
                    color="warning"
                    variant="outlined"
                  />
                  <Tooltip title={t("settleRemindAction") ?? "Send payment reminder"}>
                    <IconButton size="small" onClick={() => void remind(name)}>
                      <NotificationsIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Button
                    size="small"
                    variant="contained"
                    color="success"
                    startIcon={<CheckIcon />}
                    onClick={() => {
                      setBulkDialog({
                        debtorName: name,
                        debtorUserId: u?.id ?? "",
                        totalAmountCents: info.totalCents,
                        gameCount: info.games,
                      });
                      // Default: the debtor pays themselves
                      setBulkPayerUserId(u?.id ?? "");
                      setBulkPaidToUserId("");
                      setBulkPayMethod("cash");
                      setError(null);
                    }}
                  >
                    {t("settleMarkAllPaid") ?? "Mark all paid"}
                  </Button>
                </Stack>
              );
            })}
          </Stack>
        </Paper>
      )}

      {/* Matrix (compact view) */}
      <Paper sx={{ borderRadius: 3, overflow: "auto" }}>
        <Box sx={{ p: 2, pb: 1 }}>
          <Typography variant="h6">
            {t("settleMatrixTitle") ?? "Payments matrix"}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {t("settleMatrixHelp") ?? "Each cell shows a game payment. Green ✓ = settled, blank = not in this game."}
          </Typography>
        </Box>
        <Table size="small" sx={{ minWidth: 600 }}>
          <TableHead>
            <TableRow>
              <TableCell sx={{ position: "sticky", left: 0, backgroundColor: (t) => t.palette.background.paper, fontWeight: 700 }}>
                {t("settleMatrixPlayerHeader") ?? "Player"}
              </TableCell>
              {data.games.map((g) => (
                <TableCell key={g.gameHistoryId} align="center" sx={{ fontWeight: 700, fontSize: "0.75rem" }}>
                  <Tooltip title={new Date(g.dateTime).toLocaleString()}>
                    <span>{formatDate(g.dateTime)}</span>
                  </Tooltip>
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {data.players.map((name) => (
              <TableRow key={name}>
                <TableCell sx={{ position: "sticky", left: 0, backgroundColor: (t) => t.palette.background.paper, fontWeight: 600 }}>
                  {name}
                </TableCell>
                {data.games.map((g) => {
                  const cell = g.cells[name];
                  if (!cell || cell.status === "absent") {
                    return <TableCell key={g.gameHistoryId} align="center" sx={{ color: "text.disabled" }}>—</TableCell>;
                  }
                  if (cell.settled) {
                    return (
                      <TableCell key={g.gameHistoryId} align="center">
                        <Tooltip
                          title={
                            <>
                              <div>{t("settleSettledAt")?.replace("{when}", cell.settledAt ? new Date(cell.settledAt).toLocaleString() : "")
                                ?? `Settled ${cell.settledAt ? new Date(cell.settledAt).toLocaleString() : ""}`}</div>
                              {cell.payerName && <div>{t("settlePaidBy")?.replace("{payer}", cell.payerName) ?? `Paid by ${cell.payerName}`}</div>}
                              {cell.paidToName && <div>{t("settlePaidTo")?.replace("{receiver}", cell.paidToName) ?? `Paid to ${cell.paidToName}`}</div>}
                            </>
                          }
                        >
                          <Chip label="✓" size="small" color="success" />
                        </Tooltip>
                      </TableCell>
                    );
                  }
                  return (
                    <TableCell key={g.gameHistoryId} align="center" sx={{ color: "warning.main" }}>
                      {formatMoney(cell.amountCents, currency)}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>

      {/* Single-game settle dialog */}
      <Dialog open={!!dialog} onClose={() => !busy && setDialog(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{t("settleDialogTitle") ?? "Mark as paid"}</DialogTitle>
        <DialogContent>
          {dialog && (
            <Stack spacing={2} sx={{ mt: 1 }}>
              <Typography variant="body2">
                {t("settleDialogBody")?.replace("{player}", dialog.debtorName).replace("{amount}", formatMoney(dialog.amountCents, currency))
                  ?? `${dialog.debtorName} owes ${formatMoney(dialog.amountCents, currency)} for this game.`}
              </Typography>
              <FormControl size="small" fullWidth>
                <InputLabel>{t("settleFieldMethod") ?? "Method"}</InputLabel>
                <Select
                  value={payMethod}
                  label={t("settleFieldMethod") ?? "Method"}
                  onChange={(e) => setPayMethod(e.target.value)}
                >
                  <MenuItem value="cash">{t("settleMethodCash") ?? "Cash"}</MenuItem>
                  <MenuItem value="mbway">{t("settleMethodMbway") ?? "MB Way"}</MenuItem>
                  <MenuItem value="revolut">{t("settleMethodRevolut") ?? "Revolut"}</MenuItem>
                  <MenuItem value="transfer">{t("settleMethodTransfer") ?? "Bank transfer"}</MenuItem>
                </Select>
              </FormControl>
              <FormControl size="small" fullWidth>
                <InputLabel>{t("settleFieldPayer") ?? "Paid by"}</InputLabel>
                <Select
                  value={payerUserId}
                  label={t("settleFieldPayer") ?? "Paid by"}
                  onChange={(e) => setPayerUserId(e.target.value)}
                >
                  {eventUsers.map((u) => (
                    <MenuItem key={u.id} value={u.id}>{u.name}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl size="small" fullWidth>
                <InputLabel>{t("settleFieldPaidTo") ?? "Paid to"}</InputLabel>
                <Select
                  value={paidToUserId}
                  label={t("settleFieldPaidTo") ?? "Paid to"}
                  onChange={(e) => setPaidToUserId(e.target.value)}
                >
                  {eventUsers.map((u) => (
                    <MenuItem key={u.id} value={u.id}>{u.name}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              {error && <Alert severity="error">{error}</Alert>}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialog(null)} disabled={busy}>{t("cancel")}</Button>
          <Button
            onClick={() => { if (dialog) { void settleOne(dialog); } }}
            variant="contained"
            color="success"
            startIcon={<CheckIcon />}
            disabled={busy}
          >
            {t("settleMarkPaid") ?? "Mark paid"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Bulk settle dialog */}
      <Dialog open={!!bulkDialog} onClose={() => !busy && setBulkDialog(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{t("settleBulkDialogTitle") ?? "Mark all debts as settled"}</DialogTitle>
        <DialogContent>
          {bulkDialog && (
            <Stack spacing={2} sx={{ mt: 1 }}>
              <Typography variant="body2">
                {t("settleBulkDialogBody")?.replace("{player}", bulkDialog.debtorName).replace("{games}", String(bulkDialog.gameCount)).replace("{amount}", formatMoney(bulkDialog.totalAmountCents, currency))
                  ?? `${bulkDialog.debtorName} owes ${formatMoney(bulkDialog.totalAmountCents, currency)} across ${bulkDialog.gameCount} games. Mark all as settled?`}
              </Typography>
              <FormControl size="small" fullWidth>
                <InputLabel>{t("settleFieldMethod") ?? "Method"}</InputLabel>
                <Select
                  value={bulkPayMethod}
                  label={t("settleFieldMethod") ?? "Method"}
                  onChange={(e) => setBulkPayMethod(e.target.value)}
                >
                  <MenuItem value="cash">{t("settleMethodCash") ?? "Cash"}</MenuItem>
                  <MenuItem value="mbway">{t("settleMethodMbway") ?? "MB Way"}</MenuItem>
                  <MenuItem value="revolut">{t("settleMethodRevolut") ?? "Revolut"}</MenuItem>
                  <MenuItem value="transfer">{t("settleMethodTransfer") ?? "Bank transfer"}</MenuItem>
                </Select>
              </FormControl>
              <FormControl size="small" fullWidth>
                <InputLabel>{t("settleFieldPayer") ?? "Paid by"}</InputLabel>
                <Select
                  value={bulkPayerUserId}
                  label={t("settleFieldPayer") ?? "Paid by"}
                  onChange={(e) => setBulkPayerUserId(e.target.value)}
                >
                  {eventUsers.map((u) => (
                    <MenuItem key={u.id} value={u.id}>{u.name}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl size="small" fullWidth>
                <InputLabel>{t("settleFieldPaidTo") ?? "Paid to"}</InputLabel>
                <Select
                  value={bulkPaidToUserId}
                  label={t("settleFieldPaidTo") ?? "Paid to"}
                  onChange={(e) => setBulkPaidToUserId(e.target.value)}
                >
                  {eventUsers.map((u) => (
                    <MenuItem key={u.id} value={u.id}>{u.name}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              {error && <Alert severity="error">{error}</Alert>}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBulkDialog(null)} disabled={busy}>{t("cancel")}</Button>
          <Button
            onClick={() => { if (bulkDialog) { void settleBulk(bulkDialog); } }}
            variant="contained"
            color="success"
            startIcon={<CheckIcon />}
            disabled={busy}
          >
            {t("settleMarkAllPaid") ?? "Mark all paid"}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
