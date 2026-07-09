import React from "react";
import { Box, Chip, Stack, Typography, alpha, useTheme } from "@mui/material";
import { useT } from "~/lib/useT";

export interface PaymentChipEntry {
  playerName: string;
  amount: number;
  status: string;
  method?: string | null;
}

interface Props {
  payments: PaymentChipEntry[];
  editable?: boolean;
  /** Called when a chip is tapped (index into `payments`). */
  onToggle?: (idx: number) => void;
  /** Index of the chip currently being saved, if any. */
  savingIdx?: number | null;
  /** Returns true when a chip should be non-interactive (e.g. already paid). */
  isDisabled?: (entry: PaymentChipEntry, idx: number) => boolean;
  /** Show the "paid via <method>" reference list below the chips. */
  showMethodRefs?: boolean;
}

/**
 * Presentational payment chips shared by the history page and the post-game
 * banner so both surfaces render the same optimistic payment UX (ADR 0020).
 */
export function PaymentChips({
  payments,
  editable = false,
  onToggle,
  savingIdx = null,
  isDisabled,
  showMethodRefs = false,
}: Props) {
  const t = useT();
  const theme = useTheme();

  if (payments.length === 0) return null;

  return (
    <Box sx={{
      p: 2, borderRadius: 3,
      backgroundColor: alpha(theme.palette.action.hover, 0.04),
      border: `1px solid ${alpha(theme.palette.divider, 0.08)}`,
    }}>
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
        {payments.map((p, idx) => {
          const isPaid = p.status === "paid";
          const disabled = !editable || !onToggle || (isDisabled?.(p, idx) ?? false);
          return (
            <Chip
              key={p.playerName}
              size="small"
              variant={isPaid ? "filled" : "outlined"}
              color={isPaid ? "success" : "warning"}
              label={`${p.playerName}  ${p.amount.toFixed(2)}`}
              onClick={disabled ? undefined : () => onToggle?.(idx)}
              disabled={savingIdx === idx}
              clickable={!disabled}
              sx={{
                borderRadius: 2,
                fontWeight: isPaid ? 600 : 400,
                ...(!disabled ? { cursor: "pointer" } : {}),
              }}
            />
          );
        })}
      </Box>
      {showMethodRefs && payments.some((p) => p.method) && (
        <Stack spacing={0.25} sx={{ mt: 1.5, pt: 1.5, borderTop: `1px dashed ${alpha(theme.palette.divider, 0.2)}` }}>
          {payments.filter((p) => p.method).map((p) => (
            <Typography key={p.playerName} variant="caption" color="text.secondary">
              {t("historyPaymentRef", { ref: `${p.playerName}: ${p.method}` })}
            </Typography>
          ))}
        </Stack>
      )}
    </Box>
  );
}
