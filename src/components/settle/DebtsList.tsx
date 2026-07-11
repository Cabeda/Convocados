import React from "react";
import {
  Box, Stack, Typography, Paper, Avatar, Popover, MenuList, MenuItem, ListItemIcon, ListItemText, Alert,
} from "@mui/material";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import CheckIcon from "@mui/icons-material/Check";
import NotificationsIcon from "@mui/icons-material/Notifications";
import QrCode2Icon from "@mui/icons-material/QrCode2";
import { alpha } from "@mui/material";
import { useT } from "~/lib/useT";
import type { PairwiseDebt } from "~/lib/pairwise";

interface Props {
  debts: PairwiseDebt[];
  currency: string;
  onMarkSettled: (debt: PairwiseDebt) => void;
  onRemind: (debt: PairwiseDebt) => void;
  onGenerateQr: (debt: PairwiseDebt) => void;
}

function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(cents / 100);
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("")
    .slice(0, 2);
}

export function DebtsList({ debts, currency, onMarkSettled, onRemind, onGenerateQr }: Props) {
  const t = useT();
  const [menuAnchor, setMenuAnchor] = React.useState<{ el: HTMLElement; debt: PairwiseDebt } | null>(null);

  if (debts.length === 0) {
    return (
      <Alert severity="success" data-testid="debts-all-clear">
        {t("settleDebtsAllClear") ?? "All caught up. No outstanding payments."}
      </Alert>
    );
  }

  return (
    <Paper sx={{ p: 2, borderRadius: 3 }} data-testid="debts-list">
      <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1.5 }}>
        {t("settleDebtsTitle") ?? "Debts"}
      </Typography>
      <Stack spacing={1.5}>
        {debts.map((debt, idx) => (
          <Box
            key={`${debt.fromName}->${debt.toName}-${idx}`}
            role="button"
            tabIndex={0}
            aria-label={`${debt.fromName} owes ${debt.toName} ${formatMoney(debt.amountCents, currency)}`}
            onClick={(e) => setMenuAnchor({ el: e.currentTarget, debt })}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setMenuAnchor({ el: e.currentTarget, debt });
              }
            }}
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 2,
              p: 1.5,
              borderRadius: 2,
              cursor: "pointer",
              bgcolor: (theme) => alpha(theme.palette.background.default, 0.4),
              transition: "background-color 0.15s ease",
              "&:hover": {
                bgcolor: (theme) => alpha(theme.palette.action.hover, 0.8),
              },
              "&:focus-visible": {
                outline: (theme) => `2px solid ${theme.palette.primary.main}`,
                outlineOffset: 2,
              },
            }}
            data-testid={`debt-row-${debt.fromName}-${debt.toName}`}
          >
            {/* Debtor side */}
            <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", minWidth: 0, flex: 1 }}>
              <Avatar
                src={undefined}
                sx={{ width: 40, height: 40, bgcolor: "primary.main" }}
                alt={debt.fromName}
              >
                {initials(debt.fromName)}
              </Avatar>
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="body1" fontWeight={600} noWrap>
                  {debt.fromName}
                </Typography>
                <Typography
                  variant="body2"
                  fontWeight={700}
                  sx={{ color: (theme) => theme.palette.warning.main }}
                >
                  {formatMoney(debt.amountCents, currency)}
                </Typography>
              </Box>
            </Stack>

            {/* Arrow */}
            <ArrowForwardIcon
              fontSize="small"
              sx={{ color: "text.secondary", flexShrink: 0 }}
              aria-hidden
            />

            {/* Creditor side */}
            <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", minWidth: 0, flex: 1, justifyContent: "flex-end" }}>
              <Box sx={{ minWidth: 0, textAlign: "right" }}>
                <Typography variant="body1" fontWeight={600} noWrap>
                  {debt.toName}
                </Typography>
              </Box>
              <Box sx={{ position: "relative" }}>
                <Avatar
                  src={undefined}
                  sx={{
                    width: 40,
                    height: 40,
                    bgcolor: "secondary.main",
                  }}
                  alt={debt.toName}
                  data-testid={`creditor-avatar-${debt.toName}`}
                >
                  {initials(debt.toName)}
                </Avatar>
                {/* online dot — presence is intentionally not tracked here; render a static dot for now */}
                <Box
                  sx={{
                    position: "absolute",
                    right: 2,
                    bottom: 2,
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    bgcolor: "success.main",
                    border: (theme) => `2px solid ${theme.palette.background.paper}`,
                  }}
                />
              </Box>
            </Stack>
          </Box>
        ))}
      </Stack>

      <Popover
        open={!!menuAnchor}
        anchorEl={menuAnchor?.el ?? null}
        onClose={() => setMenuAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
      >
        <MenuList dense>
          <MenuItem
            onClick={() => {
              if (menuAnchor) {
                onMarkSettled(menuAnchor.debt);
                setMenuAnchor(null);
              }
            }}
            data-testid="debt-action-mark-settled"
          >
            <ListItemIcon><CheckIcon fontSize="small" /></ListItemIcon>
            <ListItemText>{t("settleDebtsActionMarkSettled") ?? "Mark debt as settled"}</ListItemText>
          </MenuItem>
          <MenuItem
            onClick={() => {
              if (menuAnchor) {
                onRemind(menuAnchor.debt);
                setMenuAnchor(null);
              }
            }}
            data-testid="debt-action-remind"
          >
            <ListItemIcon><NotificationsIcon fontSize="small" /></ListItemIcon>
            <ListItemText>
              {t("settleDebtsActionRemind")?.replace("{name}", menuAnchor?.debt.fromName ?? "")
                ?? `Remind ${menuAnchor?.debt.fromName ?? ""}`}
            </ListItemText>
          </MenuItem>
        </MenuList>
      </Popover>
    </Paper>
  );
}
