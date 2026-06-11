import React, { useState } from "react";
import {
  Paper, Typography, Box, Stack, Tooltip, IconButton, Button,
} from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import CheckIcon from "@mui/icons-material/Check";
import PhoneIcon from "@mui/icons-material/Phone";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import { useT } from "~/lib/useT";
import type { TranslationKey } from "~/lib/i18n";
import {
  type PaymentMethod,
  type PaymentMethodType,
  getDeepLink,
  getDisplayValue,
  getMbwayAppLink,
} from "~/lib/paymentMethods";

const LABEL_KEYS: Record<PaymentMethodType, TranslationKey> = {
  phone: "paymentMethodPhone",
  mbway: "paymentMethodMbway",
  revolut_tag: "paymentMethodRevolutTag",
  revolut_link: "paymentMethodRevolutLink",
  cash: "paymentMethodCash",
  other: "paymentMethodOther",
};

interface Props {
  methods: PaymentMethod[];
  amount?: number;
  currency?: string;
}

/**
 * Reusable list of payment methods with deep-links, copy buttons, and MB WAY app-open.
 * Used in PaymentSection (admin view) and QuickJoin interstitial (player view).
 */
export function PaymentMethodsList({ methods, amount, currency }: Props) {
  const t = useT();
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopy = async (text: string, id: string) => {
    const copyText = amount && amount > 0 ? `${text} — ${amount.toFixed(2)} ${currency ?? "EUR"}` : text;
    await navigator.clipboard.writeText(copyText);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2500);
  };

  if (methods.length === 0) return null;

  return (
    <Stack spacing={0.75}>
      {methods.map((m, idx) => {
        const deepLink = getDeepLink(m, amount, currency);
        const display = getDisplayValue(m);
        const isCopied = copiedId === `method-${idx}`;
        const label = t(LABEL_KEYS[m.type]);

        return (
          <Paper key={`${m.type}-${m.value}-${idx}`} variant="outlined" sx={{
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
  );
}

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
