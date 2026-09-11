import { useState, type ReactElement } from "react";
import { Box, Typography, Button, Snackbar, alpha, useTheme } from "@mui/material";
import NotificationsActiveIcon from "@mui/icons-material/NotificationsActive";
import NotificationsOffIcon from "@mui/icons-material/NotificationsOff";
import BlockIcon from "@mui/icons-material/Block";
import AddToHomeScreenIcon from "@mui/icons-material/AddToHomeScreen";
import { useT } from "~/lib/useT";
import { useDevicePush } from "~/lib/useDevicePush";
import type { DevicePushState } from "~/lib/devicePush";

/**
 * Device-level push state for the current browser/PWA.
 *
 * Distinct from the account's global push toggle: a device can be blocked,
 * missing the PWA install (iOS), or simply never subscribed while the account
 * preference is on. Surfaces the real state and an enable/disable action.
 */
export function DevicePushSection() {
  const t = useT();
  const theme = useTheme();
  const { state, busy, enable, disable } = useDevicePush();
  const [error, setError] = useState<string | null>(null);

  if (state === null) return null;

  const view: Record<DevicePushState, { label: string; accent: string; strong: boolean; icon: ReactElement }> = {
    on: {
      label: t("notifyDeviceOn"),
      accent: theme.palette.success.main,
      strong: true,
      icon: <NotificationsActiveIcon fontSize="small" color="success" />,
    },
    off: {
      label: t("notifyDeviceOff"),
      accent: theme.palette.text.secondary,
      strong: false,
      icon: <NotificationsOffIcon fontSize="small" color="disabled" />,
    },
    blocked: {
      label: t("notifyDeviceBlocked"),
      accent: theme.palette.warning.main,
      strong: false,
      icon: <BlockIcon fontSize="small" color="warning" />,
    },
    "needs-install": {
      label: t("notifyDeviceNeedsInstall"),
      accent: theme.palette.info.main,
      strong: true,
      icon: <AddToHomeScreenIcon fontSize="small" color="info" />,
    },
    unsupported: {
      label: t("notifyDeviceUnsupported"),
      accent: theme.palette.text.secondary,
      strong: false,
      icon: <NotificationsOffIcon fontSize="small" color="disabled" />,
    },
  };
  const { label, accent, strong, icon } = view[state];

  const handleEnable = async () => {
    const result = await enable();
    if (!result.ok) setError(t("notifyPushEnableFailed"));
  };
  const handleDisable = async () => {
    if (!(await disable())) setError(t("notifyPushDisableFailed"));
  };

  return (
    <Box
      sx={{
        mb: 2, p: 1.5, borderRadius: 2,
        bgcolor: alpha(accent, strong ? 0.06 : 0.04),
        border: `1px solid ${alpha(accent, 0.25)}`,
      }}
    >
      <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 0.6 }}>
        {t("notifyThisDeviceTitle")}
      </Typography>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 0.25 }}>
        {icon}
        <Typography variant="body2" fontWeight={600} sx={{ flex: 1 }}>
          {label}
        </Typography>
        {state === "on" && (
          <Button size="small" color="inherit" disabled={busy} onClick={handleDisable} sx={{ flexShrink: 0 }}>
            {t("notifyDisableDevice")}
          </Button>
        )}
        {state === "off" && (
          <Button size="small" variant="contained" disabled={busy} onClick={handleEnable} sx={{ flexShrink: 0 }}>
            {t("notifyEnableDevice")}
          </Button>
        )}
      </Box>
      <Snackbar
        open={!!error}
        autoHideDuration={4000}
        onClose={() => setError(null)}
        message={error ?? ""}
      />
    </Box>
  );
}
