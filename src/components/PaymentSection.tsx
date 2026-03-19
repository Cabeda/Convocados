import React, { useState } from "react";
import useSWR from "swr";
import {
  Accordion, AccordionSummary, AccordionDetails, Box, Typography, TextField,
  Button, Stack, Chip, IconButton, Tooltip, Paper, alpha, useTheme,
  Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions,
  InputAdornment, Select, MenuItem, FormControl,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import PaymentsIcon from "@mui/icons-material/Payments";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import CheckIcon from "@mui/icons-material/Check";
import DeleteIcon from "@mui/icons-material/Delete";
import { useT } from "~/lib/useT";

interface PaymentData {
  id: string;
  playerName: string;
  amount: number;
  status: string;
  method: string | null;
  paidAt: string | null;
}

interface CostData {
  id: string;
  totalAmount: number;
  currency: string;
  paymentDetails: string | null;
  payments: PaymentData[];
  summary: {
    paidCount: number;
    totalCount: number;
    paidAmount: number;
  };
}

const CURRENCIES = ["EUR", "USD", "GBP", "BRL", "CHF"];

export function PaymentSection({
  eventId,
  canEdit,
  activePlayerCount,
}: {
  eventId: string;
  canEdit: boolean;
  activePlayerCount: number;
}) {
  const t = useT();
  const theme = useTheme();
  const [costDraft, setCostDraft] = useState("");
  const [currencyDraft, setCurrencyDraft] = useState("EUR");
  const [detailsDraft, setDetailsDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [snackMsg, setSnackMsg] = useState<string | null>(null);

  const fetcher = (url: string) => fetch(url).then((r) => r.json());
  const { data: costData, mutate } = useSWR<CostData | null>(
    `/api/events/${eventId}/cost`,
    fetcher,
    { revalidateOnFocus: true },
  );

  const hasCost = costData && costData.totalAmount > 0;
  const perPlayer = hasCost && activePlayerCount > 0
    ? costData.totalAmount / activePlayerCount
    : 0;

  const handleSaveCost = async () => {
    const amount = parseFloat(costDraft);
    if (!amount || amount <= 0) return;
    setEditing(false);
    await fetch(`/api/events/${eventId}/cost`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        totalAmount: amount,
        currency: currencyDraft,
        paymentDetails: detailsDraft || null,
      }),
    });
    mutate();
  };

  const handleRemoveCost = async () => {
    setConfirmRemoveOpen(false);
    await fetch(`/api/events/${eventId}/cost`, { method: "DELETE" });
    mutate();
  };

  const handleTogglePayment = async (playerName: string, currentStatus: string) => {
    const nextStatus = currentStatus === "pending" ? "paid" : currentStatus === "paid" ? "exempt" : "pending";
    await fetch(`/api/events/${eventId}/payments`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerName, status: nextStatus }),
    });
    mutate();
  };

  const handleCopyDetails = async () => {
    if (costData?.paymentDetails) {
      await navigator.clipboard.writeText(costData.paymentDetails);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  const startEditing = () => {
    setCostDraft(hasCost ? String(costData.totalAmount) : "");
    setCurrencyDraft(hasCost ? costData.currency : "EUR");
    setDetailsDraft(hasCost ? costData.paymentDetails ?? "" : "");
    setEditing(true);
  };

  const statusColor = (status: string) => {
    if (status === "paid") return "success";
    if (status === "exempt") return "info";
    return "default";
  };

  const statusLabel = (status: string) => {
    if (status === "paid") return t("paymentStatusPaid");
    if (status === "exempt") return t("paymentStatusExempt");
    return t("paymentStatusPending");
  };

  return (
    <>
      <Accordion
        disableGutters
        elevation={0}
        defaultExpanded={!!hasCost}
        sx={{ "&:before": { display: "none" }, backgroundColor: "transparent" }}
      >
        <AccordionSummary
          expandIcon={<ExpandMoreIcon />}
          sx={{ px: 0, minHeight: 0, "& .MuiAccordionSummary-content": { my: 0.5 } }}
        >
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, width: "100%" }}>
            <PaymentsIcon fontSize="small" color="action" />
            <Typography variant="body2" color="text.secondary">
              {t("splitTheCost")}
            </Typography>
            {hasCost && costData.summary && (
              <Chip
                label={t("paymentSummary", {
                  paid: String(costData.summary.paidCount),
                  total: String(costData.summary.totalCount),
                  amount: costData.summary.paidAmount.toFixed(2),
                  currency: costData.currency,
                })}
                size="small"
                color="primary"
                variant="outlined"
                sx={{ ml: "auto" }}
              />
            )}
          </Box>
        </AccordionSummary>
        <AccordionDetails sx={{ px: 0, pt: 0 }}>
          <Stack spacing={2}>
            {/* Cost setup / edit form */}
            {editing ? (
              <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                <Stack spacing={2}>
                  <Box sx={{ display: "flex", gap: 1, alignItems: "flex-start" }}>
                    <TextField
                      label={t("totalCost")}
                      type="number"
                      size="small"
                      value={costDraft}
                      onChange={(e) => setCostDraft(e.target.value)}
                      inputProps={{ min: 0, step: 0.01 }}
                      sx={{ flex: 1 }}
                      autoFocus
                      onKeyDown={(e) => { if (e.key === "Enter") handleSaveCost(); if (e.key === "Escape") setEditing(false); }}
                    />
                    <FormControl size="small" sx={{ minWidth: 80 }}>
                      <Select
                        value={currencyDraft}
                        onChange={(e) => setCurrencyDraft(e.target.value)}
                      >
                        {CURRENCIES.map((c) => (
                          <MenuItem key={c} value={c}>{c}</MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Box>
                  <TextField
                    label={t("paymentDetails")}
                    placeholder={t("paymentDetailsPlaceholder")}
                    size="small"
                    value={detailsDraft}
                    onChange={(e) => setDetailsDraft(e.target.value.slice(0, 500))}
                    multiline
                    maxRows={3}
                    inputProps={{ maxLength: 500 }}
                  />
                  {activePlayerCount > 0 && costDraft && parseFloat(costDraft) > 0 && (
                    <Typography variant="body2" color="text.secondary">
                      {t("perPlayer", { amount: (parseFloat(costDraft) / activePlayerCount).toFixed(2) })}
                    </Typography>
                  )}
                  <Box sx={{ display: "flex", gap: 1 }}>
                    <Button variant="contained" size="small" onClick={handleSaveCost}>
                      {hasCost ? t("updateCost") : t("setCost")}
                    </Button>
                    <Button variant="text" size="small" onClick={() => setEditing(false)}>
                      {t("cancel")}
                    </Button>
                  </Box>
                </Stack>
              </Paper>
            ) : hasCost ? (
              <Stack spacing={1.5}>
                {/* Cost summary */}
                <Box sx={{
                  display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap",
                  px: 2, py: 1, borderRadius: 2,
                  backgroundColor: alpha(theme.palette.success.main, 0.06),
                }}>
                  <Typography variant="body1" fontWeight={600}>
                    {costData.totalAmount.toFixed(2)} {costData.currency}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    ({t("perPlayer", { amount: perPlayer.toFixed(2) })})
                  </Typography>
                  {canEdit && (
                    <Box sx={{ ml: "auto", display: "flex", gap: 0.5 }}>
                      <Button size="small" variant="text" onClick={startEditing}>
                        {t("updateCost")}
                      </Button>
                      <Tooltip title={t("removeCost")}>
                        <IconButton size="small" color="error" onClick={() => setConfirmRemoveOpen(true)}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  )}
                </Box>

                {/* Payment details */}
                {costData.paymentDetails && (
                  <Paper variant="outlined" sx={{
                    borderRadius: 2, p: 1, display: "flex", alignItems: "center", gap: 1,
                  }}>
                    <Typography variant="body2" sx={{
                      flexGrow: 1, fontFamily: "monospace", fontSize: "0.8rem",
                      whiteSpace: "pre-wrap", wordBreak: "break-word",
                    }}>
                      {costData.paymentDetails}
                    </Typography>
                    <Tooltip title={copied ? t("paymentDetailsCopied") : t("copyPaymentDetails")}>
                      <IconButton size="small" color={copied ? "success" : "default"} onClick={handleCopyDetails}>
                        {copied ? <CheckIcon fontSize="small" /> : <ContentCopyIcon fontSize="small" />}
                      </IconButton>
                    </Tooltip>
                  </Paper>
                )}

                {/* Per-player payment chips */}
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
                  {costData.payments.map((p) => (
                    <Chip
                      key={p.playerName}
                      label={`${p.playerName} — ${p.amount.toFixed(2)}`}
                      color={statusColor(p.status) as any}
                      variant={p.status === "pending" ? "outlined" : "filled"}
                      size="small"
                      onClick={canEdit ? () => handleTogglePayment(p.playerName, p.status) : undefined}
                      sx={{
                        cursor: canEdit ? "pointer" : "default",
                        ...(canEdit && {
                          "&:hover": { opacity: 0.85 },
                        }),
                      }}
                    />
                  ))}
                </Box>

                {/* Legend */}
                <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap" }}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                    <Chip label="" size="small" color="success" sx={{ width: 12, height: 12, minWidth: 12 }} />
                    <Typography variant="caption" color="text.secondary">{t("paymentStatusPaid")}</Typography>
                  </Box>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                    <Chip label="" size="small" variant="outlined" sx={{ width: 12, height: 12, minWidth: 12 }} />
                    <Typography variant="caption" color="text.secondary">{t("paymentStatusPending")}</Typography>
                  </Box>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                    <Chip label="" size="small" color="info" sx={{ width: 12, height: 12, minWidth: 12 }} />
                    <Typography variant="caption" color="text.secondary">{t("paymentStatusExempt")}</Typography>
                  </Box>
                </Box>
              </Stack>
            ) : canEdit ? (
              <Button variant="outlined" size="small" startIcon={<PaymentsIcon />} onClick={startEditing}>
                {t("setCost")}
              </Button>
            ) : (
              <Typography variant="body2" color="text.secondary">
                {t("noCostSet")}
              </Typography>
            )}
          </Stack>
        </AccordionDetails>
      </Accordion>

      {/* Remove cost confirmation */}
      <Dialog open={confirmRemoveOpen} onClose={() => setConfirmRemoveOpen(false)}>
        <DialogTitle>{t("removeCost")}</DialogTitle>
        <DialogContent>
          <DialogContentText>{t("removeCostConfirm")}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmRemoveOpen(false)}>{t("cancel")}</Button>
          <Button onClick={handleRemoveCost} color="error" variant="contained">{t("removeCost")}</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
