import React, { useMemo, useState } from "react";
import {
  Box, Stack, Typography, Button, Chip, Paper, Alert,
  IconButton, Menu, MenuItem, ListItemIcon, ListItemText, Divider,
  Dialog, DialogTitle, DialogContent, DialogActions, Tooltip,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import SportsSoccerIcon from "@mui/icons-material/SportsSoccer";
import AutorenewIcon from "@mui/icons-material/Autorenew";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import HandshakeIcon from "@mui/icons-material/Handshake";
import PeopleIcon from "@mui/icons-material/People";
import { useT } from "~/lib/useT";

export interface Transaction {
  id: string;
  date: string;
  type: "game" | "subscription" | "spend" | "settlement";
  description: string;
  amountCents: number;
  currency: string;
  status: string;
  playerName?: string;
  gamePlayers?: string[];
  gameHistoryId?: string;
  category?: string;
  allocation?: { mode: string; shares?: Record<string, number> };
}

type Filter = "all" | "game" | "subscription" | "spend" | "settlement";

interface Props {
  transactions: Transaction[];
  onAddTransaction: () => void;
  onEditTransaction: (tx: Transaction) => void;
  onDeleteTransaction: (tx: Transaction) => void;
}

function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(cents / 100);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

function TypeIcon({ type }: { type: Transaction["type"] }) {
  switch (type) {
    case "game":
      return <SportsSoccerIcon fontSize="small" data-testid={`txn-icon-${type}`} />;
    case "subscription":
      return <AutorenewIcon fontSize="small" data-testid={`txn-icon-${type}`} />;
    case "spend":
      return <ReceiptLongIcon fontSize="small" data-testid={`txn-icon-${type}`} />;
    case "settlement":
      return <HandshakeIcon fontSize="small" data-testid={`txn-icon-${type}`} />;
  }
}

function statusSeverity(status: string): "default" | "success" | "warning" {
  if (status === "paid" || status === "active") return "success";
  if (status === "pending" || status === "sent") return "warning";
  return "default";
}

function GamePlayersText({ players }: { players: string[] }) {
  if (!players || players.length === 0) return null;
  const display = players.slice(0, 3).join(", ");
  const more = players.length > 3 ? ` +${players.length - 3} more` : "";
  return (
    <Tooltip title={players.join(", ")} arrow>
      <Box
        component="span"
        data-testid="game-players-icon"
        sx={{ fontSize: "0.75rem", fontWeight: 500, ml: 1, cursor: "help", color: "text.secondary" }}
      >
        <PeopleIcon fontSize="small" sx={{ verticalAlign: "middle", mr: 0.5 }} />
        {display}
        {more}
      </Box>
    </Tooltip>
  );
}

export function TransactionsList({ transactions, onAddTransaction, onEditTransaction, onDeleteTransaction }: Props) {
  const t = useT();
  const [filter, setFilter] = useState<Filter>("all");
  const [menuFor, setMenuFor] = useState<{ el: HTMLElement; tx: Transaction } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Transaction | null>(null);

  const filtered = useMemo(
    () => (filter === "all" ? transactions : transactions.filter((tx) => tx.type === filter)),
    [transactions, filter],
  );

  const filters: Array<{ value: Filter; label: string }> = [
    { value: "all", label: t("settleTxnsFilterAll") ?? "All" },
    { value: "game", label: t("settleTxnsFilterGames") ?? "Games" },
    { value: "subscription", label: t("settleTxnsFilterSubs") ?? "Subscriptions" },
    { value: "spend", label: t("settleTxnsFilterSpends") ?? "Spends" },
    { value: "settlement", label: t("settleTxnsFilterSettlements") ?? "Settlements" },
  ];

  return (
    <Stack spacing={2}>
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 1 }}
      >
        <Stack direction="row" spacing={0.5} sx={{ flexWrap: "wrap" }}>
          {filters.map((f) => (
            <Chip
              key={f.value}
              size="small"
              label={f.label}
              onClick={() => setFilter(f.value)}
              color={filter === f.value ? "primary" : "default"}
              variant={filter === f.value ? "filled" : "outlined"}
              data-testid={`txn-filter-${f.value}`}
            />
          ))}
        </Stack>
        <Box sx={{ flex: 1 }} />
        <Button
          variant="outlined"
          size="small"
          startIcon={<AddIcon />}
          onClick={onAddTransaction}
          data-testid="add-transaction-button"
        >
          {t("settleTxnsAddButton") ?? "Add transaction"}
        </Button>
      </Stack>

      {filtered.length === 0 ? (
        <Alert severity="info" data-testid="transactions-empty">
          {transactions.length === 0
            ? t("settleTxnsEmptyNone") ?? "No transactions yet. Add a subscription or a one-off spend to get started."
            : t("settleTxnsEmptyFiltered") ?? "No transactions match the selected filter."}
        </Alert>
      ) : (
        <Stack spacing={1} data-testid="transactions-list">
          {filtered.map((tx) => (
            <Paper
              key={tx.id}
              variant="outlined"
              data-testid="txn-row"
              sx={{ p: 1.5, borderRadius: 2 }}
            >
              <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
                <Box sx={{ color: "text.secondary", display: "flex", alignItems: "center" }}>
                  <TypeIcon type={tx.type} />
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" fontWeight={600} noWrap>
                    {tx.description}
                    {tx.type === "game" && tx.gamePlayers && tx.gamePlayers.length > 0 && (
                      <GamePlayersText players={tx.gamePlayers} />
                    )}
                    {tx.type === "spend" && tx.category && (
                      <Chip
                        size="small"
                        label={tx.category.replace("_", " ")}
                        variant="outlined"
                        color="default"
                        sx={{ ml: 1, fontSize: "0.7rem", height: 20 }}
                      />
                    )}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {formatDate(tx.date)}
                  </Typography>
                </Box>
                <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                  <Chip
                    size="small"
                    label={tx.status}
                    color={statusSeverity(tx.status)}
                    variant="outlined"
                  />
                  <Typography variant="body1" fontWeight={700} sx={{ minWidth: 80, textAlign: "right" }}>
                    {formatMoney(tx.amountCents, tx.currency)}
                  </Typography>
                  <IconButton
                    size="small"
                    aria-label="row actions"
                    onClick={(e) => setMenuFor({ el: e.currentTarget, tx })}
                    data-testid={`txn-row-actions-${tx.id}`}
                  >
                    <MoreVertIcon fontSize="small" />
                  </IconButton>
                </Stack>
              </Stack>
            </Paper>
          ))}
        </Stack>
      )}

      <Menu
        open={!!menuFor}
        anchorEl={menuFor?.el ?? null}
        onClose={() => setMenuFor(null)}
      >
        <MenuItem
          onClick={() => {
            const tx = menuFor!.tx;
            setMenuFor(null);
            onEditTransaction(tx);
          }}
          data-testid="txn-row-edit"
        >
          <ListItemIcon><EditIcon fontSize="small" /></ListItemIcon>
          <ListItemText>{t("settleTxnRowEdit") ?? "Edit"}</ListItemText>
        </MenuItem>
        <Divider />
        <MenuItem
          onClick={() => {
            const tx = menuFor!.tx;
            setMenuFor(null);
            setConfirmDelete(tx);
          }}
          data-testid="txn-row-delete"
        >
          <ListItemIcon><DeleteIcon fontSize="small" color="error" /></ListItemIcon>
          <ListItemText sx={{ color: "error.main" }}>{t("settleTxnRowDelete") ?? "Delete"}</ListItemText>
        </MenuItem>
      </Menu>

      <Dialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{t("settleTxnDeleteTitle") ?? "Delete this transaction?"}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            {t("settleTxnDeleteConfirm") ?? "This will permanently remove the transaction. It cannot be undone."}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDelete(null)}>
            {t("settleTxnDeleteCancel") ?? "Cancel"}
          </Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => {
              if (confirmDelete) {
                onDeleteTransaction(confirmDelete);
                setConfirmDelete(null);
              }
            }}
            data-testid="txn-delete-confirm"
          >
            {t("settleTxnDeleteAction") ?? "Delete"}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}