/* eslint-disable @eslint-react/set-state-in-effect, react-hooks/set-state-in-effect -- fetch sets state */
import React, { useState } from "react";
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, Stack, TextField, Box, FormControl, Select, MenuItem,
  Alert, InputAdornment, Chip,
} from "@mui/material";
import AutorenewIcon from "@mui/icons-material/Autorenew";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import { useT } from "~/lib/useT";

export interface AddTransactionEventUser {
  id: string;
  name: string;
}

interface Props {
  open: boolean;
  eventId: string;
  eventUsers: AddTransactionEventUser[];
  onClose: () => void;
  onSaved: () => void;
}

type Type = "subscription" | "spend";

/**
 * Add Transaction dialog (UX best practice: a single "+ Add" button that
 * opens a focused modal with a type chip + form).
 *
 * Type:
 *   - subscription → POST /settle/subscriptions { userId }
 *   - spend        → POST /settle/extras { label, amountCents }
 */
export function AddTransactionDialog({ open, eventId, eventUsers, onClose, onSaved }: Props) {
  const t = useT();
  const [type, setType] = useState<Type>("subscription");
  const [userId, setUserId] = useState<string>("");
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setType("subscription");
    setUserId("");
    setLabel("");
    setAmount("");
    setError(null);
  };

  const handleSave = async () => {
    setError(null);

    if (type === "subscription") {
      if (!userId) {
        setError(t("addTxnNoUser") ?? "Pick a player first.");
        return;
      }
      setSaving(true);
      try {
        const res = await fetch(`/api/events/${eventId}/settle/subscriptions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setError((body as { error?: string }).error ?? `Failed (${res.status}).`);
          return;
        }
        reset();
        onSaved();
        onClose();
      } catch (e) {
        setError(String(e));
      } finally {
        setSaving(false);
      }
      return;
    }

    // type === "spend"
    const trimmed = label.trim();
    if (!trimmed) {
      setError(t("addTxnNoLabel") ?? "Enter a label for the spend.");
      return;
    }
    const amountNum = Number(amount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      setError(t("addTxnInvalidAmount") ?? "Enter a positive amount.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/events/${eventId}/settle/extras`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: trimmed, amountCents: Math.round(amountNum * 100) }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError((body as { error?: string }).error ?? `Failed (${res.status}).`);
        return;
      }
      reset();
      onSaved();
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t("addTxnTitle") ?? "Add transaction"}</DialogTitle>
      <DialogContent>
        <Stack spacing={2.5} sx={{ pt: 0.5 }}>
          {/* Type picker — chip group for the two transaction kinds */}
          <Stack direction="row" spacing={1} data-testid="add-txn-type">
            <Chip
              icon={<AutorenewIcon />}
              label={t("addTxnTypeSubscription") ?? "Subscription"}
              onClick={() => setType("subscription")}
              color={type === "subscription" ? "primary" : "default"}
              variant={type === "subscription" ? "filled" : "outlined"}
              data-testid="add-txn-type-subscription"
              clickable
            />
            <Chip
              icon={<ReceiptLongIcon />}
              label={t("addTxnTypeSpend") ?? "One-off spend"}
              onClick={() => setType("spend")}
              color={type === "spend" ? "primary" : "default"}
              variant={type === "spend" ? "filled" : "outlined"}
              data-testid="add-txn-type-spend"
              clickable
            />
          </Stack>

          {type === "subscription" ? (
            <FormControl size="small" fullWidth>
              <Select
                data-testid="add-txn-user-select"
                value={userId}
                displayEmpty
                onChange={(e) => setUserId(String(e.target.value))}
                renderValue={(v) => {
                  if (!v) return t("addTxnPickPlayer") ?? "Pick a player";
                  const u = eventUsers.find((eu) => eu.id === v);
                  return u?.name ?? "";
                }}
              >
                {eventUsers.length === 0 ? (
                  <MenuItem disabled value="__none__">
                    {t("addTxnNoUsers") ?? "No players in this event yet."}
                  </MenuItem>
                ) : (
                  eventUsers.map((u) => (
                    <MenuItem key={u.id} value={u.id}>{u.name}</MenuItem>
                  ))
                )}
              </Select>
            </FormControl>
          ) : (
            <Stack spacing={1.5}>
              <TextField
                size="small"
                label={t("addTxnLabel") ?? "Label (e.g. Bought balls)"}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                slotProps={{ htmlInput: { maxLength: 200 } }}
                data-testid="add-txn-spend-label"
                fullWidth
              />
              <TextField
                size="small"
                label={t("addTxnAmount") ?? "Amount"}
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                slotProps={{
                  htmlInput: { step: "0.01", min: "0" },
                  input: { startAdornment: <InputAdornment position="start">€</InputAdornment> },
                }}
                data-testid="add-txn-spend-amount"
                fullWidth
              />
            </Stack>
          )}

          {error && (
            <Alert severity="error" onClose={() => setError(null)}>
              {error}
            </Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2, gap: 1 }}>
        <Button onClick={onClose} disabled={saving}>
          {t("cancel") ?? "Cancel"}
        </Button>
        <Button variant="contained" onClick={handleSave} disabled={saving} data-testid="add-txn-save">
          {type === "subscription"
            ? (t("addTxnSaveSubscription") ?? "Add subscription")
            : (t("addTxnSaveSpend") ?? "Add spend")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
