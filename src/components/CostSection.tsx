import { useState, useEffect } from "react";
import {
  Paper, Typography, Box, Stack, Button, Dialog, DialogTitle, DialogContent,
  DialogActions, TextField, Select, MenuItem, FormControl, InputLabel,
  IconButton, Alert,
} from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import AddIcon from "@mui/icons-material/Add";
import { useT } from "~/lib/useT";
import {
  type PaymentMethod,
  type PaymentMethodType,
  PAYMENT_METHOD_TYPES,
  parsePaymentMethods,
  getDisplayValue,
} from "~/lib/paymentMethods";
import { useEventCost, type EventCostData } from "~/lib/useEventCost";
import { formatMoney } from "~/lib/money";
import { PaymentMethodsList } from "./PaymentMethodsList";

const CURRENCIES = ["EUR", "USD", "GBP", "BRL", "CHF"];

/**
 * Cost & payment-methods manager for the payments page. Owners edit the price
 * (with this-game / all-future scope) and the payment methods; everyone else
 * sees the price, per-player share and where to send the money.
 */
export function CostSection({ eventId, isManager, maxPlayers }: { eventId: string; isManager: boolean; maxPlayers: number }) {
  const t = useT();
  const { cost, load } = useEventCost(eventId);
  const [open, setOpen] = useState(false);

  if (!cost) return null;

  // Per-player price = total / required playing slots (maxPlayers). Fixed for
  // the event — it does not change with the number of players in the list.
  const share = cost.totalAmount > 0 && maxPlayers > 0 ? cost.totalAmount / maxPlayers : null;
  const methods = parsePaymentMethods(cost.effectivePaymentMethods);

  return (
    <Paper sx={{ p: 2, mt: 2 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
        <Typography variant="h6">{t("costAndMethods")}</Typography>
        {isManager && (
          <Button size="small" onClick={() => setOpen(true)} sx={{ ml: "auto" }}>
            {t("editPrice")}
          </Button>
        )}
      </Box>
      <Stack spacing={1} sx={{ mt: 1 }}>
        {cost.totalAmount > 0 ? (
          <Typography variant="body1" fontWeight={600}>
            {formatMoney(cost.totalAmount, cost.currency)}
            {share ? ` · ${t("perPlayer", { amount: formatMoney(share, cost.currency) })}` : ""}
          </Typography>
        ) : (
          <Typography variant="body2" color="text.secondary">{t("postGameNoCostSet")}</Typography>
        )}
        {methods.length > 0 && <PaymentMethodsList methods={methods} />}
      </Stack>

      <CostEditorDialog
        open={open}
        eventId={eventId}
        cost={cost}
        onClose={() => setOpen(false)}
        onSaved={async () => {
          setOpen(false);
          await load();
        }}
      />
    </Paper>
  );
}

function CostEditorDialog({
  open, eventId, cost, onClose, onSaved,
}: {
  open: boolean;
  eventId: string;
  cost: EventCostData;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const t = useT();
  const [amount, setAmount] = useState(String(cost.totalAmount || ""));
  const [currency, setCurrency] = useState(cost.currency || "EUR");
  const [scope, setScope] = useState<"this_game" | "all_future">("all_future");
  const [methods, setMethods] = useState<PaymentMethod[]>(parsePaymentMethods(cost.paymentMethods));
  const [saving, setSaving] = useState(false);
  const [localErr, setLocalErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setAmount(String(cost.totalAmount || ""));
    setCurrency(cost.currency || "EUR");
    setMethods(parsePaymentMethods(cost.paymentMethods));
    setLocalErr(null);
  }, [open, cost]);

  const addMethod = () => setMethods((prev) => [...prev, { type: "mbway", value: "" }]);
  const updateMethod = (idx: number, field: keyof PaymentMethod, val: string) =>
    setMethods((prev) => prev.map((m, i) => (i === idx ? { ...m, [field]: val } : m)));
  const removeMethod = (idx: number) => setMethods((prev) => prev.filter((_, i) => i !== idx));

  const save = async () => {
    const totalAmount = parseFloat(amount);
    if (!totalAmount || totalAmount <= 0) {
      setLocalErr(t("paymentsFailed"));
      return;
    }
    setSaving(true);
    setLocalErr(null);
    try {
      const res = await fetch(`/api/events/${eventId}/cost`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          totalAmount,
          currency,
          scope,
          paymentMethods: methods.filter((m) => m.value.trim()).length > 0
            ? methods.filter((m) => m.value.trim())
            : null,
        }),
      });
      if (!res.ok) {
        setLocalErr(t("paymentsFailed"));
        return;
      }
      await onSaved();
    } catch {
      setLocalErr(t("paymentsFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t("editPrice")}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField label={t("totalCost")} type="number" value={amount} onChange={(e) => setAmount(e.target.value)} fullWidth />
          <FormControl fullWidth>
            <InputLabel>{t("currency")}</InputLabel>
            <Select label={t("currency")} value={currency} onChange={(e) => setCurrency(e.target.value as string)}>
              {CURRENCIES.map((c) => <MenuItem key={c} value={c}>{c}</MenuItem>)}
            </Select>
          </FormControl>
          <FormControl fullWidth>
            <InputLabel>{t("costAndMethods")}</InputLabel>
            <Select label={t("costAndMethods")} value={scope} onChange={(e) => setScope(e.target.value as "this_game" | "all_future")}>
              <MenuItem value="all_future">{t("scopeAllFuture")}</MenuItem>
              <MenuItem value="this_game">{t("scopeThisGame")}</MenuItem>
            </Select>
          </FormControl>
          <Typography variant="caption" color="text.secondary">{t("paymentMethods")}</Typography>
          {methods.map((m, idx) => (
            <Box key={`${m.type}-${idx}`} sx={{ display: "flex", gap: 1, alignItems: "center" }}>
              <FormControl size="small" sx={{ minWidth: 130 }}>
                <Select value={m.type} onChange={(e) => updateMethod(idx, "type", e.target.value as PaymentMethodType)}>
                  {PAYMENT_METHOD_TYPES.map((pt) => <MenuItem key={pt} value={pt}>{pt}</MenuItem>)}
                </Select>
              </FormControl>
              <TextField size="small" placeholder={getDisplayValue(m)} value={m.value} onChange={(e) => updateMethod(idx, "value", e.target.value)} sx={{ flex: 1 }} />
              <IconButton size="small" onClick={() => removeMethod(idx)}><DeleteIcon fontSize="small" /></IconButton>
            </Box>
          ))}
          <Button size="small" variant="text" startIcon={<AddIcon />} onClick={addMethod} sx={{ alignSelf: "flex-start" }}>
            {t("addPaymentMethod")}
          </Button>
          {localErr && <Alert severity="error">{localErr}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("paymentsCancel")}</Button>
        <Button variant="contained" disabled={saving} onClick={save}>{t("paymentsSave")}</Button>
      </DialogActions>
    </Dialog>
  );
}
