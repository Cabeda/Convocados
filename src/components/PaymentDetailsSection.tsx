import { useEffect, useState } from "react";
import {
  Alert, Box, Button, Divider, FormControl, FormControlLabel, FormHelperText,
  IconButton, MenuItem, Paper, Select, Snackbar, Stack, Switch,
  TextField, Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import PaymentsIcon from "@mui/icons-material/Payments";
import { useT } from "~/lib/useT";
import { apiRequest } from "~/lib/api/client";
import {
  PAYMENT_METHOD_TYPES,
  getMethodTypeLabel,
  type PaymentMethod,
  type PaymentMethodType,
} from "~/lib/paymentMethods";

/**
 * A person's own Payment Details (ADR 0055). Saving them is not consent to
 * publish them — `sharePaymentDetails` is a separate switch, and the copy names
 * the audience so nobody turns it on by accident.
 */
export function PaymentDetailsSection() {
  const t = useT();
  const [phone, setPhone] = useState("");
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [share, setShare] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snackbar, setSnackbar] = useState<string | null>(null);

  useEffect(() => {
    apiRequest("GET /api/me/payment-details")
      .then((body) => {
        const data = body as { phone?: string | null; paymentDetails?: PaymentMethod[]; sharePaymentDetails?: boolean };
        setPhone(data.phone ?? "");
        setMethods(Array.isArray(data.paymentDetails) ? data.paymentDetails : []);
        setShare(Boolean(data.sharePaymentDetails));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const updateMethod = (index: number, field: keyof PaymentMethod, value: string) => {
    setMethods((prev) => prev.map((m, i) => (i === index ? { ...m, [field]: value } : m)));
  };

  const addMethod = () => setMethods((prev) => [...prev, { type: "mbway", value: phone }]);

  const removeMethod = (index: number) => setMethods((prev) => prev.filter((_, i) => i !== index));

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const clean = methods.filter((m) => m.value.trim());
      await apiRequest("PUT /api/me/payment-details", {
        body: {
          phone: phone.trim(),
          paymentDetails: clean,
          sharePaymentDetails: share,
        },
      });
      setSnackbar(t("myPaymentDetailsSaved"));
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : t("myPaymentDetailsSaveError");
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Paper elevation={1} sx={{ p: 3 }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
        <PaymentsIcon color="action" fontSize="small" />
        <Typography variant="h6" fontWeight={600}>{t("myPaymentDetails")}</Typography>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t("myPaymentDetailsDesc")}
      </Typography>

      <Divider sx={{ mb: 2 }} />

      <Stack spacing={2}>
        <TextField
          label={t("myPhoneNumber")}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          size="small"
          fullWidth
          helperText={t("myPhoneNumberHint")}
          disabled={loading}
        />

        <Typography variant="subtitle2" fontWeight={600}>{t("myPaymentDetailsMethods")}</Typography>
        {methods.length === 0 && (
          <Typography variant="body2" color="text.secondary">{t("myPaymentDetailsEmpty")}</Typography>
        )}
        {methods.map((m, idx) => (
          <Box key={`${m.type}-${idx}`} sx={{ display: "flex", gap: 1, alignItems: "center" }}>
            <FormControl size="small" sx={{ minWidth: 140 }}>
              <Select
                value={m.type}
                onChange={(e) => updateMethod(idx, "type", e.target.value as PaymentMethodType)}
              >
                {PAYMENT_METHOD_TYPES.map((pt) => (
                  <MenuItem key={pt} value={pt}>{getMethodTypeLabel(pt)}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField
              size="small"
              value={m.value}
              onChange={(e) => updateMethod(idx, "value", e.target.value)}
              sx={{ flex: 1 }}
            />
            <IconButton size="small" onClick={() => removeMethod(idx)} aria-label={t("paymentsRemove")}>
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Box>
        ))}
        <Button
          size="small"
          variant="text"
          startIcon={<AddIcon />}
          onClick={addMethod}
          sx={{ alignSelf: "flex-start" }}
        >
          {t("addPaymentMethod")}
        </Button>

        <Divider />

        <FormControlLabel
          control={<Switch checked={share} onChange={(e) => setShare(e.target.checked)} />}
          label={t("shareMyPaymentDetails")}
          disabled={loading}
        />
        <FormHelperText sx={{ mt: -1 }}>{t("shareMyPaymentDetailsDesc")}</FormHelperText>

        {error && <Alert severity="error">{error}</Alert>}
        <Box>
          <Button variant="contained" onClick={save} disabled={saving || loading}>
            {t("paymentsSave")}
          </Button>
        </Box>
      </Stack>

      <Snackbar
        open={Boolean(snackbar)}
        autoHideDuration={3000}
        onClose={() => setSnackbar(null)}
        message={snackbar}
      />
    </Paper>
  );
}
