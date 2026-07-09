/* eslint-disable @eslint-react/set-state-in-effect, react-hooks/set-state-in-effect -- Sync-from-server pattern: server data initializes local state, async fetch responses set state. Common in this codebase. */
import React, { useState, useEffect, useCallback } from "react";
import {
  Box, Typography, Stack, Chip, IconButton, Tooltip, Paper, alpha, useTheme,
  Button, Accordion, AccordionSummary, AccordionDetails,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import PaymentsIcon from "@mui/icons-material/Payments";
import CheckIcon from "@mui/icons-material/Check";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import PhoneIcon from "@mui/icons-material/Phone";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import { useT } from "~/lib/useT";
import type { TranslationKey } from "~/lib/i18n";
import {
  type PaymentMethod,
  type PaymentMethodType,
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
  effectivePaymentMethods: string | null;
  payments: PaymentData[];
  summary: {
    paidCount: number;
    totalCount: number;
    paidAmount: number;
  };
}

/** Map method type to i18n key for the label */
const LABEL_KEYS: Record<PaymentMethodType, TranslationKey> = {
  phone: "paymentMethodPhone",
  mbway: "paymentMethodMbway",
  revolut_tag: "paymentMethodRevolutTag",
  revolut_link: "paymentMethodRevolutLink",
  cash: "paymentMethodCash",
  other: "paymentMethodOther",
};

/**
 * Phase-aware game phase derived from dateTime:
 *  - upcoming_far  : >24h before
 *  - upcoming_soon : <24h before
 *  - upcoming_urgent: <2h before
 *  - live          : during (between dateTime and dateTime + durationMinutes)
 *  - past          : after game ended
 */
type GamePhaseDetail = "upcoming_far" | "upcoming_soon" | "upcoming_urgent" | "live" | "past";

function derivePhase(dateTime: string, durationMinutes: number): GamePhaseDetail {
  const now = Date.now();
  const start = new Date(dateTime).getTime();
  const end = start + durationMinutes * 60_000;
  const msUntil = start - now;
  if (now >= start && now < end) return "live";
  if (now >= end) return "past";
  if (msUntil < 2 * 60 * 60_000) return "upcoming_urgent";
  if (msUntil < 24 * 60 * 60_000) return "upcoming_soon";
  return "upcoming_far";
}

export function PaymentSection({
  eventId,
  canEdit,
  activePlayerCount,
  maxPlayers,
  dateTime,
  durationMinutes = 90,
  expanded: controlledExpanded,
  onExpandedChange,
  onPaymentChange: _onPaymentChange,
  currentUserName = null,
}: {
  eventId: string;
  /** Whether the current user is owner/admin — shows manage link more prominently */
  canEdit: boolean;
  /** Number of active (non-bench) players currently on the list */
  activePlayerCount: number;
  /** Event max players — used for price preview before payment list exists */
  maxPlayers: number;
  dateTime: string;
  durationMinutes?: number;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  onPaymentChange?: () => void;
  currentUserName?: string | null;
}) {
  const t = useT();
  const theme = useTheme();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [selfReportSaving, setSelfReportSaving] = useState(false);

  const [costData, setCostData] = useState<CostData | null>(null);

  const fetchCost = useCallback(async () => {
    try {
      const r = await fetch(`/api/events/${eventId}/cost`);
      if (r.ok) setCostData(await r.json());
      else setCostData(null);
    } catch { /* ignore */ }
  }, [eventId]);

  useEffect(() => { fetchCost(); }, [fetchCost, activePlayerCount]);

  // Poll every 15s
  useEffect(() => {
    const id = setInterval(fetchCost, 15_000);
    return () => clearInterval(id);
  }, [fetchCost]);

  const storageKey = `paymentsSection_expanded_${eventId}`;
  const [accordionOpen, setAccordionOpen] = useState(() => {
    try { return localStorage.getItem(storageKey) === "true"; } catch { return false; }
  });

  useEffect(() => {
    try { localStorage.setItem(storageKey, String(accordionOpen)); } catch {}
  }, [accordionOpen, storageKey]);

  // Auto-expand when phase becomes urgent (<24h) or controlled
  const phase = derivePhase(dateTime, durationMinutes);
  useEffect(() => {
    if (phase === "upcoming_soon" || phase === "upcoming_urgent") setAccordionOpen(true);
  }, [phase]);
  useEffect(() => {
    if (controlledExpanded === true) setAccordionOpen(true);
  }, [controlledExpanded]);

  const hasCost = costData !== null && costData.totalAmount > 0;
  const methods: PaymentMethod[] = hasCost ? parsePaymentMethods(costData.effectivePaymentMethods) : [];

  // Per-player amount: actual list count if available, otherwise maxPlayers preview
  const paymentListCount = hasCost ? costData.payments.length : 0;
  const divisor = paymentListCount > 0 ? paymentListCount : Math.max(maxPlayers, 1);
  const perPlayer = hasCost ? costData.totalAmount / divisor : 0;
  const isPreview = paymentListCount === 0;

  const paidCount = hasCost ? costData.summary.paidCount : 0;
  const totalCount = hasCost ? costData.summary.totalCount : 0;

  // Current user's payment row (matched by name, case-insensitive)
  const myPayment = hasCost && currentUserName && costData.payments.length > 0
    ? costData.payments.find((p) => p.playerName.toLowerCase() === currentUserName.toLowerCase())
    : null;
  const myStatus = myPayment?.status ?? null; // "pending" | "sent" | "paid" | null
  const myAmount = myPayment?.amount ?? perPlayer;

  // Hide entirely when no cost set (player can't do anything)
  if (!hasCost) return null;

  // Phase-derived urgency color
  const urgencyColor: "warning" | "error" | "success" | "default" =
    myStatus === "paid" ? "success"
    : myStatus === "sent" ? "default"
    : phase === "upcoming_urgent" || phase === "live" ? "error"
    : phase === "upcoming_soon" ? "warning"
    : "default";

  const urgencyBg =
    urgencyColor === "error" ? alpha(theme.palette.error.main, 0.08)
    : urgencyColor === "warning" ? alpha(theme.palette.warning.main, 0.08)
    : urgencyColor === "success" ? alpha(theme.palette.success.main, 0.06)
    : alpha(theme.palette.action.hover, 0.04);

  const urgencyBorder =
    urgencyColor === "error" ? alpha(theme.palette.error.main, 0.3)
    : urgencyColor === "warning" ? alpha(theme.palette.warning.main, 0.3)
    : urgencyColor === "success" ? alpha(theme.palette.success.main, 0.3)
    : alpha(theme.palette.divider, 0.3);

  // Self-report "I paid" — moves pending → sent
  const handleSelfReport = async () => {
    if (!myPayment || myStatus !== "pending") return;
    setSelfReportSaving(true);
    try {
      await fetch(`/api/events/${eventId}/payments`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerName: myPayment.playerName, status: "sent" }),
      });
      await fetchCost();
    } catch { /* ignore */ }
    setSelfReportSaving(false);
  };

  const handleCopy = async (text: string, id: string) => {
    try { await navigator.clipboard.writeText(text); } catch { /* ignore */ }
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2500);
  };

  return (
    <Paper id="payment-section" elevation={2} sx={{ borderRadius: 3, overflow: "hidden" }}>
      {/* ── Prominent CTA bar — shown outside accordion for maximum visibility ── */}
      {myStatus !== null && phase !== "past" && (
        <Box sx={{
          px: { xs: 2, sm: 3 }, pt: 2, pb: 1.5,
          background: urgencyBg,
          borderBottom: `1px solid ${urgencyBorder}`,
        }}>
          {myStatus === "paid" ? (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <CheckIcon sx={{ color: theme.palette.success.main, fontSize: 18 }} />
              <Typography variant="body2" color="success.main" fontWeight={600}>
                {t("paymentYouPaid")}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ ml: "auto" }}>
                {t("paymentSocialProof", { paid: String(paidCount), total: String(totalCount) })}
              </Typography>
            </Box>
          ) : myStatus === "sent" ? (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <PaymentsIcon sx={{ color: theme.palette.info.main, fontSize: 18 }} />
              <Typography variant="body2" color="info.main" fontWeight={600}>
                {t("paymentNudgeSentConfirmation")}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ ml: "auto" }}>
                {t("paymentSocialProof", { paid: String(paidCount), total: String(totalCount) })}
              </Typography>
            </Box>
          ) : (
            /* pending — show debt + payment method chips */
            <Stack spacing={1.5}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                <PaymentsIcon sx={{
                  color: urgencyColor === "error" ? theme.palette.error.main : theme.palette.warning.main,
                  fontSize: 20,
                }} />
                <Typography variant="body1" fontWeight={700}>
                  {t("paymentsYouOwe", { amount: myAmount.toFixed(2), currency: costData.currency })}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ ml: "auto" }}>
                  {t("paymentSocialProof", { paid: String(paidCount), total: String(totalCount) })}
                </Typography>
              </Box>

              {/* One-tap payment methods */}
              {methods.length > 0 && (
                <Box sx={{ display: "flex", gap: 0.75, flexWrap: "wrap" }}>
                  {methods.map((m, idx) => {
                    const deepLink = getDeepLink(m, myAmount, costData.currency);
                    const display = getDisplayValue(m);
                    return (
                      <Chip
                        key={`cta-${m.type}-${idx}`}
                        label={`${t(LABEL_KEYS[m.type])}${display ? ` · ${display}` : ""}`}
                        size="small"
                        color={urgencyColor === "error" ? "error" : "warning"}
                        variant="outlined"
                        component={deepLink ? "a" : "span"}
                        href={deepLink || undefined}
                        target={deepLink ? "_blank" : undefined}
                        rel={deepLink ? "noopener noreferrer" : undefined}
                        clickable={!!deepLink}
                        sx={{ fontWeight: 600, borderRadius: 2 }}
                      />
                    );
                  })}
                </Box>
              )}

              {/* Self-report button */}
              <Button
                size="small"
                variant="text"
                onClick={handleSelfReport}
                disabled={selfReportSaving}
                sx={{ alignSelf: "flex-start", textTransform: "none", opacity: 0.75 }}
              >
                {t("paymentNudgeMarkSent")}
              </Button>
            </Stack>
          )}
        </Box>
      )}

      {/* Post-game read-only summary */}
      {phase === "past" && (
        <Box sx={{
          px: { xs: 2, sm: 3 }, pt: 2, pb: 1.5,
          display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap",
          borderBottom: `1px solid ${alpha(theme.palette.divider, 0.3)}`,
        }}>
          <PaymentsIcon fontSize="small" color="action" />
          <Typography variant="body2" color="text.secondary">
            {t("paymentSocialProof", { paid: String(paidCount), total: String(totalCount) })}
          </Typography>
          <Button
            size="small"
            variant="text"
            component="a"
            href={`/events/${eventId}/settle`}
            endIcon={<OpenInNewIcon fontSize="small" />}
            sx={{ ml: "auto", textTransform: "none" }}
          >
            {t("paymentsViewAll")}
          </Button>
        </Box>
      )}

      {/* ── Accordion: price breakdown + payment methods details ── */}
      <Box sx={{ px: { xs: 2, sm: 3 }, py: 0.5 }}>
        <Accordion
          disableGutters
          elevation={0}
          expanded={accordionOpen}
          onChange={(_e, exp) => {
            setAccordionOpen(exp);
            onExpandedChange?.(exp);
          }}
          sx={{ "&:before": { display: "none" }, backgroundColor: "transparent" }}
        >
          <AccordionSummary
            expandIcon={<ExpandMoreIcon />}
            sx={{ px: 0, minHeight: 0, "& .MuiAccordionSummary-content": { my: 0.75 } }}
          >
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, width: "100%" }}>
              <PaymentsIcon fontSize="small" color="action" />
              <Typography variant="body2" color="text.secondary">
                {t("paymentsSection")}
              </Typography>
              {/* Price pill: actual per-player or preview */}
              <Chip
                label={isPreview
                  ? t("paymentsPricePreview", { amount: perPlayer.toFixed(2), currency: costData.currency })
                  : t("paymentsPrice", { amount: perPlayer.toFixed(2), currency: costData.currency })
                }
                size="small"
                variant="outlined"
                sx={{ ml: "auto", fontWeight: 600, fontSize: "0.7rem" }}
              />
            </Box>
          </AccordionSummary>
          <AccordionDetails sx={{ px: 0, pt: 0, pb: 1 }}>
            <Stack spacing={1.5}>
              {/* Total + per-player breakdown */}
              <Box sx={{
                display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap",
                px: 1.5, py: 1, borderRadius: 2,
                backgroundColor: alpha(theme.palette.success.main, 0.06),
              }}>
                <Typography variant="body1" fontWeight={600}>
                  {costData.totalAmount.toFixed(2)} {costData.currency}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {isPreview
                    ? t("paymentsPerPlayerPreview", { amount: perPlayer.toFixed(2), max: String(maxPlayers) })
                    : t("paymentsPerPlayer", { amount: perPlayer.toFixed(2), total: String(paymentListCount) })
                  }
                </Typography>
                <Box sx={{ flex: 1 }} />
                <Button
                  size="small"
                  component="a"
                  href={`/events/${eventId}/settle`}
                  endIcon={<OpenInNewIcon fontSize="small" />}
                  sx={{ textTransform: "none", fontSize: "0.75rem" }}
                >
                  {canEdit ? t("paymentsManageLink") : t("paymentsViewAll")}
                </Button>
              </Box>

              {/* Payment methods */}
              {methods.length > 0 && (
                <Stack spacing={0.75}>
                  {methods.map((m, idx) => {
                    const deepLink = getDeepLink(m, perPlayer, costData.currency);
                    const display = getDisplayValue(m);
                    const isCopied = copiedId === `method-${idx}`;
                    const label = t(LABEL_KEYS[m.type]);

                    return (
                      <Paper key={`${m.type}-${m.label ?? ""}-${idx}`} variant="outlined" sx={{
                        borderRadius: 2, px: 1.5, py: 0.75,
                        display: "flex", alignItems: "center", gap: 1,
                      }}>
                        <MethodIcon type={m.type} />
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Typography variant="caption" color="text.secondary">
                            {label}{m.label ? ` — ${m.label}` : ""}
                          </Typography>
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
            </Stack>
          </AccordionDetails>
        </Accordion>
      </Box>
    </Paper>
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
    case "cash":
      return <Box sx={{ ...sx, bgcolor: "#4caf50", color: "#fff" }}>$</Box>;
    case "other":
      return <Box sx={{ ...sx, bgcolor: "#9e9e9e", color: "#fff" }}>?</Box>;
  }
}
