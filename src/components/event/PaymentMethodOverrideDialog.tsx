/* eslint-disable @eslint-react/set-state-in-effect, react-hooks/set-state-in-effect -- fetch sets state */
import React, { useState } from "react";
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, Stack, Typography, Box, TextField,
  FormControl, Select, MenuItem, IconButton, Tooltip,
  FormControlLabel, Switch, Alert, InputAdornment,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import PersonIcon from "@mui/icons-material/Person";
import GroupIcon from "@mui/icons-material/Group";
import { useT } from "~/lib/useT";
import type { TranslationKey } from "~/lib/i18n";
import {
  type PaymentMethod,
  type PaymentMethodType,
  PAYMENT_METHOD_TYPES,
  parsePaymentMethods,
} from "~/lib/paymentMethods";

const LABEL_KEYS: Record<PaymentMethodType, TranslationKey> = {
  phone: "paymentMethodPhone",
  mbway: "paymentMethodMbway",
  revolut_tag: "paymentMethodRevolutTag",
  revolut_link: "paymentMethodRevolutLink",
  cash: "paymentMethodCash",
  other: "paymentMethodOther",
};

const PLACEHOLDER_KEYS: Record<PaymentMethodType, TranslationKey> = {
  phone: "paymentMethodPhonePlaceholder",
  mbway: "paymentMethodMbwayPlaceholder",
  revolut_tag: "paymentMethodRevolutTagPlaceholder",
  revolut_link: "paymentMethodRevolutLinkPlaceholder",
  cash: "paymentMethodCashPlaceholder",
  other: "paymentMethodOtherPlaceholder",
};

/** User attached to an event (owner / admin / player). */
export interface PaymentMethodEventUser {
  id: string;
  name: string;
  role: "owner" | "admin" | "player";
}

export type PaymentMethodDialogMode = "default" | "override" | "auto";

interface Props {
  eventId: string;
  /** Existing default payment methods (from EventCost.paymentMethods) */
  defaultMethods: string | null;
  /** Existing one-off override (from EventCost.tempPaymentMethods) */
  overrideMethods: string | null;
  /** Whether the viewer is owner/admin — can set as default */
  canSetDefault: boolean;
  /** Event users to populate the payer picker. Pass [] if not yet loaded. */
  eventUsers: PaymentMethodEventUser[];
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  /**
   * What this dialog is editing. "default" updates the event-wide
   * `paymentMethods`; "override" updates a per-game override;
   * "auto" falls back to the old toggle-based behavior. Defaults to "auto"
   * so existing callers don't change.
   */
  mode?: PaymentMethodDialogMode;
  /**
   * Required when `mode="override"`. The GameHistory row that the
   * per-game override is being written to. Ignored in other modes.
   */
  gameHistoryId?: string;
}

const DIRECT_PAYER_ID = "__direct__";

export function PaymentMethodOverrideDialog({
  eventId,
  defaultMethods,
  overrideMethods,
  canSetDefault,
  eventUsers,
  open,
  onClose,
  onSaved,
  mode = "auto",
  gameHistoryId,
}: Props) {
  const t = useT();

  // Start from the active effective methods:
  //   - "override" mode: read the per-game override (passed via defaultMethods
  //     for simplicity — the caller resolves the right JSON).
  //   - "default"/"auto" mode: prefer the override if present (so editing
  //     the override starts from the current override values), else default.
  const sourceJson =
    mode === "override" ? defaultMethods : (overrideMethods ?? defaultMethods);
  const activeMethods = parsePaymentMethods(sourceJson);
  const [methods, setMethods] = useState<PaymentMethod[]>(() =>
    activeMethods.length > 0 ? activeMethods : [{ type: "mbway", value: "" }]
  );
  // In "default" / "override" modes the "set as default" toggle is meaningless
  // (the mode itself encodes that choice). Lock it to the mode default.
  const [setAsDefault, setSetAsDefault] = useState(mode === "auto" ? false : mode === "default");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addMethod = () =>
    setMethods((prev) => [...prev, { type: "mbway", value: "" }]);
  const removeMethod = (idx: number) =>
    setMethods((prev) => prev.filter((_, i) => i !== idx));
  const updateMethod = (idx: number, field: keyof PaymentMethod, val: string) =>
    setMethods((prev) =>
      prev.map((m, i) => (i === idx ? { ...m, [field]: val } : m))
    );

  /** Map a Picker value to the payer fields stored on the method. */
  const setPayerFromPicker = (idx: number, pickerValue: string) => {
    setMethods((prev) =>
      prev.map((m, i) => {
        if (i !== idx) return m;
        if (pickerValue === DIRECT_PAYER_ID) {
          // Strip payer — "each player pays the court directly"
          const { payerUserId: _u, payerName: _n, ...rest } = m;
          return rest as PaymentMethod;
        }
        const u = eventUsers.find((eu) => eu.id === pickerValue);
        if (!u) return m;
        return { ...m, payerUserId: u.id, payerName: u.name };
      }),
    );
  };

  const handleSave = async () => {
    const valid = methods.filter((m) => m.value.trim());
    if (valid.length === 0) {
      setError(t("paymentOverrideEmptyError"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      // Pick the right endpoint + body based on mode.
      let url: string;
      let body: unknown;
      if (mode === "override") {
        if (!gameHistoryId) {
          setError(t("paymentOverrideMissingGameId") ?? "gameHistoryId is required for per-game override.");
          setSaving(false);
          return;
        }
        url = `/api/events/${eventId}/history/${gameHistoryId}/payment-methods`;
        body = { paymentMethods: valid };
      } else if (mode === "default") {
        url = `/api/events/${eventId}/cost/override`;
        body = { paymentMethods: valid, setAsDefault: true };
      } else {
        url = `/api/events/${eventId}/cost/override`;
        body = { paymentMethods: valid, setAsDefault };
      }
      const res = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError((body as { error?: string }).error ?? t("somethingWentWrong"));
      } else {
        onSaved();
        onClose();
      }
    } catch {
      setError(t("somethingWentWrong"));
    }
    setSaving(false);
  };

  // "Override" mode edits a per-game row, so the legacy "clear override" /
  // "set as default" affordances don't apply.
  const hasOverride = Boolean(overrideMethods);
  const showSetAsDefaultToggle = mode === "auto" && canSetDefault;
  const showClearOverride = hasOverride && !setAsDefault && mode === "auto";
  const directLabel = t("paymentMethodPayerDirect") ?? "Each player pays directly to the court";

  const titleKey =
    mode === "default"
      ? "paymentOverrideDefaultTitle"
      : mode === "override"
        ? "paymentOverrideGameTitle"
        : "paymentOverrideTitle";
  const saveLabelKey =
    mode === "default"
      ? "paymentOverrideSaveDefault"
      : mode === "override"
        ? "paymentOverrideSaveGame"
        : (setAsDefault ? "paymentOverrideSaveDefault" : "paymentOverrideSaveOneOff");
  const saveColor: "primary" | "warning" =
    mode === "default" ? "primary" : mode === "override" ? "primary" : (setAsDefault ? "primary" : "warning");

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <EditIcon fontSize="small" />
        {t(titleKey) ?? t("paymentOverrideTitle")}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2.5} sx={{ pt: 0.5 }}>
          <Typography variant="body2" color="text.secondary">
            {t("paymentOverrideDesc")}
          </Typography>

          {/* Method editor */}
          <Stack spacing={2}>
            {methods.map((m, idx) => {
              const payerPickerValue = m.payerUserId ?? DIRECT_PAYER_ID;
              return (
                <Box
                  key={idx}
                  sx={{
                    p: 1.25,
                    borderRadius: 2,
                    border: (theme) => `1px solid ${theme.palette.divider}`,
                    display: "flex",
                    flexDirection: "column",
                    gap: 1,
                  }}
                  data-testid={`payment-method-row-${idx}`}
                >
                  <Box sx={{ display: "flex", gap: 1, alignItems: "flex-start", flexWrap: "wrap" }}>
                    <FormControl size="small" sx={{ minWidth: 130 }}>
                      <Select
                        value={m.type}
                        onChange={(e) => updateMethod(idx, "type", e.target.value)}
                      >
                        {PAYMENT_METHOD_TYPES.map((pt) => (
                          <MenuItem key={pt} value={pt}>{t(LABEL_KEYS[pt])}</MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                    <TextField
                      size="small"
                      placeholder={t(PLACEHOLDER_KEYS[m.type])}
                      value={m.value}
                      onChange={(e) => updateMethod(idx, "value", e.target.value)}
                      sx={{ flex: 1, minWidth: 150 }}
                      slotProps={{
                        input: m.type === "revolut_tag" ? {
                          startAdornment: <InputAdornment position="start">@</InputAdornment>,
                        } : undefined,
                      }}
                    />
                    <TextField
                      size="small"
                      placeholder={t("paymentMethodLabelPlaceholder")}
                      value={m.label ?? ""}
                      onChange={(e) => updateMethod(idx, "label", e.target.value)}
                      sx={{ flex: 0.6, minWidth: 100 }}
                      slotProps={{ htmlInput: { maxLength: 50 } }}
                    />
                    <IconButton size="small" color="error" onClick={() => removeMethod(idx)} aria-label={t("delete") ?? "Delete"}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Box>
                  {/* Payer picker — full-width below the type/value/label row. */}
                  <FormControl size="small" fullWidth>
                    <Select
                      data-testid="payment-method-payer"
                      value={payerPickerValue}
                      onChange={(e) => setPayerFromPicker(idx, e.target.value)}
                      startAdornment={
                        <InputAdornment position="start" sx={{ ml: 0.5 }}>
                          {payerPickerValue === DIRECT_PAYER_ID
                            ? <GroupIcon fontSize="small" color="action" />
                            : <PersonIcon fontSize="small" color="action" />}
                        </InputAdornment>
                      }
                      renderValue={(value) => {
                        if (value === DIRECT_PAYER_ID) return directLabel;
                        const u = eventUsers.find((eu) => eu.id === value);
                        return u ? `${u.name} (${u.role})` : directLabel;
                      }}
                    >
                      <MenuItem value={DIRECT_PAYER_ID}>
                        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                          <GroupIcon fontSize="small" color="action" />
                          <span>{directLabel}</span>
                        </Stack>
                      </MenuItem>
                      {eventUsers.length === 0 ? (
                        <MenuItem disabled value="__loading__">
                          {t("loading") ?? "Loading…"}
                        </MenuItem>
                      ) : (
                        eventUsers.map((u) => (
                          <MenuItem key={u.id} value={u.id}>
                            <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                              <PersonIcon fontSize="small" color="action" />
                              <span>{u.name}</span>
                              {u.role !== "player" && (
                                <Typography variant="caption" color="text.secondary">
                                  ({u.role})
                                </Typography>
                              )}
                            </Stack>
                          </MenuItem>
                        ))
                      )}
                    </Select>
                  </FormControl>
                </Box>
              );
            })}
            <Button
              size="small"
              variant="text"
              startIcon={<AddIcon />}
              onClick={addMethod}
              sx={{ alignSelf: "flex-start" }}
            >
              {t("addPaymentMethod")}
            </Button>
          </Stack>

          {/* set-as-default toggle — only relevant in the legacy "auto" mode */}
          {showSetAsDefaultToggle && (
            <Box sx={{ pt: 0.5 }}>
              <FormControlLabel
                control={
                  <Switch
                    checked={setAsDefault}
                    onChange={(e) => setSetAsDefault(e.target.checked)}
                    size="small"
                  />
                }
                label={
                  <Box>
                    <Typography variant="body2" fontWeight={600}>
                      {t("paymentOverrideSetDefault")}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {t("paymentOverrideSetDefaultDesc")}
                    </Typography>
                  </Box>
                }
              />
            </Box>
          )}

          {!canSetDefault && (
            <Typography variant="caption" color="text.secondary">
              {t("paymentOverrideOneOffNote")}
            </Typography>
          )}

          {error && (
            <Alert severity="error" onClose={() => setError(null)}>
              {error}
            </Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2, gap: 1 }}>
        {showClearOverride && (
          <Tooltip title={t("clearOverride")}>
            <Button
              variant="text"
              color="warning"
              size="small"
              sx={{ mr: "auto" }}
              onClick={async () => {
                await fetch(`/api/events/${eventId}/cost/override`, { method: "DELETE" });
                onSaved();
                onClose();
              }}
            >
              {t("clearOverride")}
            </Button>
          </Tooltip>
        )}
        <Button onClick={onClose} disabled={saving}>
          {t("cancel")}
        </Button>
        <Button
          variant="contained"
          color={saveColor}
          onClick={handleSave}
          disabled={saving}
        >
          {t(saveLabelKey) ?? t("paymentOverrideSaveDefault")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
