import React, { useState, useEffect, useCallback } from "react";
import {
  Accordion, AccordionSummary, AccordionDetails, Box, Typography, TextField,
  Button, Stack, Chip, IconButton, Tooltip, Paper, alpha, useTheme,
  Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions,
  Select, MenuItem, FormControl, InputAdornment,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import PaymentsIcon from "@mui/icons-material/Payments";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import CheckIcon from "@mui/icons-material/Check";
import DeleteIcon from "@mui/icons-material/Delete";
import AddIcon from "@mui/icons-material/Add";
import PhoneIcon from "@mui/icons-material/Phone";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import { useT } from "~/lib/useT";
import type { TranslationKey } from "~/lib/i18n";
import {
  type PaymentMethod,
  type PaymentMethodType,
  PAYMENT_METHOD_TYPES,
  parsePaymentMethods,
  getDeepLink,
  getDisplayValue,
  getMbwayAppLink,
} from "~/lib/paymentMethods";

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
  paymentMethods: string | null;
  payments: PaymentData[];
  summary: {
    paidCount: number;
    totalCount: number;
    paidAmount: number;
  };
}

const CURRENCIES = ["EUR", "USD", "GBP", "BRL", "CHF"];

/** Map method type to i18n key for the placeholder */
const PLACEHOLDER_KEYS: Record<PaymentMethodType, TranslationKey> = {
  phone: "paymentMethodPhonePlaceholder",
  mbway: "paymentMethodMbwayPlaceholder",
  revolut_tag: "paymentMethodRevolutTagPlaceholder",
  revolut_link: "paymentMethodRevolutLinkPlaceholder",
};

/** Map method type to i18n key for the label */
const LABEL_KEYS: Record<PaymentMethodType, TranslationKey> = {
  phone: "paymentMethodPhone",
  mbway: "paymentMethodMbway",
  revolut_tag: "paymentMethodRevolutTag",
  revolut_link: "paymentMethodRevolutLink",
};

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
  const [methodsDraft, setMethodsDraft] = useState<PaymentMethod[]>([]);
  const [editing, setEditing] = useState(false);
  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [costData, setCostData] = useState<CostData | null>(null);

  const fetchCost = useCallback(async () => {
    const r = await fetch(`/api/events/${eventId}/cost`);
    const data = await r.json();
    setCostData(data);
  }, [eventId]);

  useEffect(() => { fetchCost(); }, [fetchCost, activePlayerCount]);

  // Poll for cost updates every 10s (replaces SSE refreshKey)
  useEffect(() => {
    const id = setInterval(fetchCost, 10_000);
    return () => clearInterval(id);
  }, [fetchCost]);

  const hasCost = costData && costData.totalAmount > 0;
  const perPlayer = hasCost && activePlayerCount > 0
    ? costData.totalAmount / activePlayerCount
    : 0;
  const methods = hasCost ? parsePaymentMethods(costData.paymentMethods) : [];

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
        paymentMethods: methodsDraft.length > 0 ? methodsDraft : null,
      }),
    });
    fetchCost();
  };

  const handleRemoveCost = async () => {
    setConfirmRemoveOpen(false);
    await fetch(`/api/events/${eventId}/cost`, { method: "DELETE" });
    fetchCost();
  };

  const handleTogglePayment = async (playerName: string, currentStatus: string) => {
    const nextStatus = currentStatus === "pending" ? "paid" : currentStatus === "paid" ? "exempt" : "pending";
    await fetch(`/api/events/${eventId}/payments`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerName, status: nextStatus }),
    });
    fetchCost();
  };

  const handleCopy = async (text: string, id: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2500);
  };

  const startEditing = () => {
    setCostDraft(hasCost ? String(costData.totalAmount) : "");
    setCurrencyDraft(hasCost ? costData.currency : "EUR");
    setDetailsDraft(hasCost ? costData.paymentDetails ?? "" : "");
    setMethodsDraft(hasCost ? parsePaymentMethods(costData.paymentMethods) : []);
    setEditing(true);
  };

  const addMethod = () => {
    setMethodsDraft((prev) => [...prev, { type: "mbway", value: "" }]);
  };

  const updateMethod = (idx: number, field: keyof PaymentMethod, val: string) => {
    setMethodsDraft((prev) => prev.map((m, i) => i === idx ? { ...m, [field]: val } : m));
  };

  const removeMethod = (idx: number) => {
    setMethodsDraft((prev) => prev.filter((_, i) => i !== idx));
  };

  const statusColor = (status: string) => {
    if (status === "paid") return "success";
    if (status === "exempt") return "info";
    return "default";
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

                  {/* Structured payment methods editor */}
                  <Box>
                    <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: "block" }}>
                      {t("paymentMethods")}
                    </Typography>
                    <Stack spacing={1}>
                      {methodsDraft.map((m, idx) => (
                        <Box key={idx} sx={{ display: "flex", gap: 1, alignItems: "flex-start" }}>
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
                            sx={{ flex: 1 }}
                            InputProps={m.type === "revolut_tag" ? {
                              startAdornment: <InputAdornment position="start">@</InputAdornment>,
                            } : undefined}
                          />
                          <IconButton size="small" color="error" onClick={() => removeMethod(idx)}>
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
                    </Stack>
                  </Box>

                  {/* Legacy free-text field (collapsed, for backward compat) */}
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

                {/* Structured payment method buttons */}
                {methods.length > 0 && (
                  <Stack spacing={0.75}>
                    {methods.map((m, idx) => {
                      const deepLink = getDeepLink(m, perPlayer, costData.currency);
                      const display = getDisplayValue(m);
                      const isCopied = copiedId === `method-${idx}`;
                      const label = t(LABEL_KEYS[m.type]);

                      return (
                        <Paper key={idx} variant="outlined" sx={{
                          borderRadius: 2, px: 1.5, py: 0.75,
                          display: "flex", alignItems: "center", gap: 1,
                        }}>
                          <MethodIcon type={m.type} />
                          <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Typography variant="caption" color="text.secondary">{label}</Typography>
                            <Typography variant="body2" sx={{
                              fontFamily: "monospace", fontSize: "0.85rem",
                              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                            }}>
                              {display}
                            </Typography>
                            {m.type === "mbway" && (
                              <>
                                <Typography variant="caption" color="text.secondary" sx={{ fontStyle: "italic" }}>
                                  {t("paymentMethodMbwayInstructions")}
                                </Typography>
                                {(() => {
                                  const mbLink = getMbwayAppLink(typeof navigator !== "undefined" ? navigator.userAgent : undefined);
                                  return mbLink ? (
                                    <Button
                                      size="small"
                                      variant="outlined"
                                      color="primary"
                                      component="a"
                                      href={mbLink}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      sx={{ mt: 0.5, textTransform: "none", fontSize: "0.75rem" }}
                                    >
                                      {t("paymentMethodOpenMbway")}
                                    </Button>
                                  ) : null;
                                })()}
                              </>
                            )}
                          </Box>
                          {deepLink && (
                            <Tooltip title={m.type === "phone" ? t("paymentMethodCallPhone") : t("paymentMethodOpen")}>
                              <IconButton
                                size="small"
                                color="primary"
                                component="a"
                                href={deepLink}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                {m.type === "phone" ? <PhoneIcon fontSize="small" /> : <OpenInNewIcon fontSize="small" />}
                              </IconButton>
                            </Tooltip>
                          )}
                          <Tooltip title={isCopied ? t("paymentMethodCopied") : t("paymentMethodCopy")}>
                            <IconButton
                              size="small"
                              color={isCopied ? "success" : "default"}
                              onClick={() => handleCopy(m.type === "revolut_tag" ? `@${m.value}` : m.value, `method-${idx}`)}
                            >
                              {isCopied ? <CheckIcon fontSize="small" /> : <ContentCopyIcon fontSize="small" />}
                            </IconButton>
                          </Tooltip>
                        </Paper>
                      );
                    })}
                  </Stack>
                )}

                {/* Legacy payment details (fallback for old data) */}
                {costData.paymentDetails && methods.length === 0 && (
                  <Paper variant="outlined" sx={{
                    borderRadius: 2, p: 1, display: "flex", alignItems: "center", gap: 1,
                  }}>
                    <Typography variant="body2" sx={{
                      flexGrow: 1, fontFamily: "monospace", fontSize: "0.8rem",
                      whiteSpace: "pre-wrap", wordBreak: "break-word",
                    }}>
                      {costData.paymentDetails}
                    </Typography>
                    <Tooltip title={copiedId === "legacy" ? t("paymentDetailsCopied") : t("copyPaymentDetails")}>
                      <IconButton
                        size="small"
                        color={copiedId === "legacy" ? "success" : "default"}
                        onClick={() => handleCopy(costData.paymentDetails!, "legacy")}
                      >
                        {copiedId === "legacy" ? <CheckIcon fontSize="small" /> : <ContentCopyIcon fontSize="small" />}
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

/** Small icon for each payment method type */
function MethodIcon({ type }: { type: PaymentMethodType }) {
  const sx = { width: 20, height: 20, borderRadius: "4px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.7rem", fontWeight: 700 };
  switch (type) {
    case "phone":
      return <PhoneIcon fontSize="small" color="action" />;
    case "mbway":
      return <Box sx={{ ...sx, bgcolor: "#cc0000", color: "#fff" }}>MB</Box>;
    case "revolut_tag":
    case "revolut_link":
      return <Box sx={{ ...sx, bgcolor: "#0075EB", color: "#fff" }}>R</Box>;
  }
}
