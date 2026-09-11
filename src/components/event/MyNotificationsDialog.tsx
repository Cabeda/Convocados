import { useState, useEffect } from "react";
import {
  Dialog, DialogTitle, DialogContent, Box, Stack, Switch,
  Typography, alpha, useTheme, FormControlLabel, IconButton, Chip, Button,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import NotificationsActiveIcon from "@mui/icons-material/NotificationsActive";
import NotificationsOffIcon from "@mui/icons-material/NotificationsOff";
import BlockIcon from "@mui/icons-material/Block";
import AddToHomeScreenIcon from "@mui/icons-material/AddToHomeScreen";
import { useT } from "~/lib/useT";
import { useDevicePush } from "~/lib/useDevicePush";

interface FollowOverrides {
  following: boolean;
  mutePlayerActivity: boolean | null;
  muteReminders: boolean | null;
  mutePostGame: boolean | null;
  muteEventDetails: boolean | null;
  isPlayer?: boolean;
  isAdmin?: boolean;
  pushEnabled?: boolean;
  /** ADR 0025: per-event invite opt-out (EventPlayer.invitationOptOutAt). */
  inviteOptedOut?: boolean;
}

type OverrideField = "mutePlayerActivity" | "muteReminders" | "mutePostGame" | "muteEventDetails";

interface Props {
  eventId: string;
  open: boolean;
  onClose: () => void;
}

/**
 * Device-level push state for the current browser/PWA.
 *
 * Distinct from the account's global push toggle: a device can be blocked,
 * missing the PWA install (iOS), or simply never subscribed while the account
 * preference is on. Surfaces the real state and an enable/disable action.
 */
function DeviceSection() {
  const t = useT();
  const theme = useTheme();
  const { state, busy, enable, disable } = useDevicePush();

  if (state === null) return null;

  const label =
    state === "on" ? t("notifyDeviceOn")
      : state === "off" ? t("notifyDeviceOff")
        : state === "blocked" ? t("notifyDeviceBlocked")
          : state === "needs-install" ? t("notifyDeviceNeedsInstall")
            : t("notifyDeviceUnsupported");

  const accent =
    state === "on" ? theme.palette.success.main
      : state === "blocked" ? theme.palette.warning.main
        : state === "needs-install" ? theme.palette.info.main
          : theme.palette.text.secondary;

  return (
    <Box
      sx={{
        mb: 2, p: 1.5, borderRadius: 2,
        bgcolor: alpha(accent, state === "on" || state === "needs-install" ? 0.06 : 0.04),
        border: `1px solid ${alpha(accent, 0.25)}`,
      }}
    >
      <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 0.6 }}>
        {t("notifyThisDeviceTitle")}
      </Typography>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 0.25 }}>
        {state === "on" ? <NotificationsActiveIcon fontSize="small" color="success" />
          : state === "blocked" ? <BlockIcon fontSize="small" color="warning" />
            : state === "needs-install" ? <AddToHomeScreenIcon fontSize="small" color="info" />
              : <NotificationsOffIcon fontSize="small" color="disabled" />}
        <Typography variant="body2" fontWeight={600} sx={{ flex: 1 }}>
          {label}
        </Typography>
        {state === "on" && (
          <Button size="small" color="inherit" disabled={busy} onClick={disable} sx={{ flexShrink: 0 }}>
            {t("notifyDisableDevice")}
          </Button>
        )}
        {state === "off" && (
          <Button size="small" variant="contained" disabled={busy} onClick={enable} sx={{ flexShrink: 0 }}>
            {t("notifyEnableDevice")}
          </Button>
        )}
      </Box>
    </Box>
  );
}

/**
 * ponytail: Per-user notification preferences for a followed game.
 * Accessible from the "More" menu. Only shows when user is following.
 * Role-aware: non-players see which notifications are player-only.
 */
export function MyNotificationsDialog({ eventId, open, onClose }: Props) {
  const t = useT();
  const theme = useTheme();
  const [state, setState] = useState<FollowOverrides | null>(null);

  useEffect(() => {
    if (!open) return;
    fetch(`/api/events/${eventId}/follow`)
      .then((r) => r.json())
      .then((d) => setState(d))
      .catch(() => {});
  }, [eventId, open]);

  const toggle = async (field: OverrideField) => {
    if (!state) return;
    const current = state[field];
    const newValue = current === true ? null : true;
    setState((prev) => prev ? { ...prev, [field]: newValue } : prev);

    try {
      await fetch(`/api/events/${eventId}/follow`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: newValue }),
      });
    } catch { /* silent — local state is already updated */ }
  };

  /** ADR 0025: per-event invite opt-out — toggles EventPlayer.invitationOptOutAt
   *  via the dedicated endpoint (independent of follow overrides). */
  const toggleInviteOptOut = async () => {
    if (!state) return;
    const newValue = !state.inviteOptedOut;
    setState((prev) => prev ? { ...prev, inviteOptedOut: newValue } : prev);
    try {
      await fetch(`/api/events/${eventId}/invitation-opt-out`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ optOut: newValue }),
      });
    } catch { /* silent — local state is already updated */ }
  };

  // ponytail: Tier 2 notifications are player-only by default.
  // Non-players see them greyed out with a hint to join the game.
  const isPlayer = state?.isPlayer ?? false;

  const items: Array<{ field: OverrideField; label: string; description: string; playerOnly: boolean }> = [
    {
      field: "muteReminders",
      label: t("gameReminders"),
      description: t("notifyDescReminders"),
      playerOnly: true,
    },
    {
      field: "mutePlayerActivity",
      label: t("playerActivity"),
      description: t("notifyDescPlayerActivity"),
      playerOnly: true,
    },
    {
      field: "mutePostGame",
      label: t("postGameResults"),
      description: t("notifyDescPostGame"),
      playerOnly: true,
    },
    {
      field: "muteEventDetails",
      label: t("eventDetails"),
      description: t("notifyDescEventDetails"),
      playerOnly: false,
    },
  ];

  if (!state?.following) {
    return (
      <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Typography variant="h6" fontWeight={700} sx={{ flex: 1 }}>
            {t("myNotificationsTitle")}
          </Typography>
          <IconButton size="small" onClick={onClose}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent>
          <DeviceSection />
          <Typography variant="body2" color="text.secondary">
            {t("notifyJoinToGetNotifications")}
          </Typography>
        </DialogContent>
      </Dialog>
    );
  }

  const pushOff = state.pushEnabled === false;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <Typography variant="h6" fontWeight={700} sx={{ flex: 1 }}>
          {t("myNotificationsTitle")}
        </Typography>
        <IconButton size="small" onClick={onClose}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        <DeviceSection />
        {pushOff && (
          <Box sx={{
            mb: 2, p: 1.5, borderRadius: 2,
            bgcolor: alpha(theme.palette.warning.main, 0.08),
            border: `1px solid ${alpha(theme.palette.warning.main, 0.3)}`,
          }}>
            <Typography variant="body2" color="warning.dark" fontWeight={600}>
              {t("notifyPushDisabledTitle")}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {t("notifyPushDisabledDesc")}
            </Typography>
          </Box>
        )}
        <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 0.6 }}>
          {t("notifyAccountTitle")}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2, mt: 0.25 }}>
          {isPlayer ? t("myNotificationsDescPlayer") : t("myNotificationsDescFollower")}
        </Typography>
        <Stack spacing={1}>
          {items.map(({ field, label, description, playerOnly }) => {
            const enabled = state[field] !== true;
            const blocked = playerOnly && !isPlayer;
            const effectivelyOff = pushOff || blocked;
            return (
              <Box
                key={field}
                sx={{
                  display: "flex", alignItems: "flex-start", gap: 1.5,
                  p: 1.5, borderRadius: 2,
                  opacity: effectivelyOff ? 0.5 : 1,
                  bgcolor: effectivelyOff
                    ? alpha(theme.palette.action.hover, 0.03)
                    : enabled
                      ? alpha(theme.palette.success.main, 0.04)
                      : alpha(theme.palette.action.hover, 0.03),
                  border: `1px solid ${effectivelyOff ? alpha(theme.palette.divider, 0.3) : enabled ? alpha(theme.palette.success.main, 0.2) : alpha(theme.palette.divider, 0.5)}`,
                  transition: "all 0.15s",
                }}
              >
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
                    <Typography variant="body2" fontWeight={600}>
                      {label}
                    </Typography>
                    {blocked && (
                      <Chip label={t("playersOnly")} size="small" variant="outlined" sx={{ height: 18, fontSize: "0.6rem" }} />
                    )}
                  </Box>
                  <Typography variant="caption" color="text.secondary">
                    {blocked ? t("notifyJoinToEnable") : description}
                  </Typography>
                </Box>
                <FormControlLabel
                  control={
                    <Switch
                      size="small"
                      checked={enabled && !effectivelyOff}
                      onChange={() => toggle(field)}
                      disabled={effectivelyOff}
                    />
                  }
                  label=""
                  sx={{ m: 0, mr: -0.5 }}
                />
              </Box>
            );
          })}

          {/* ADR 0025: per-event invite opt-out — stops RSVP/recruitment pings,
              suggestions and invites for THIS event only. Independent of follow. */}
          <Box
            sx={{
              display: "flex", alignItems: "flex-start", gap: 1.5,
              p: 1.5, borderRadius: 2, mt: 1,
              bgcolor: state.inviteOptedOut
                ? alpha(theme.palette.action.hover, 0.03)
                : alpha(theme.palette.success.main, 0.04),
              border: `1px solid ${state.inviteOptedOut ? alpha(theme.palette.divider, 0.5) : alpha(theme.palette.success.main, 0.2)}`,
            }}
          >
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="body2" fontWeight={600}>
                {t("notifyInviteOptOutLabel")}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {t("notifyInviteOptOutDesc")}
              </Typography>
            </Box>
            <FormControlLabel
              control={
                <Switch
                  size="small"
                  checked={!state.inviteOptedOut}
                  onChange={toggleInviteOptOut}
                />
              }
              label=""
              sx={{ m: 0, mr: -0.5 }}
            />
          </Box>
        </Stack>
        {/* Admin-specific notifications — only shown to organizers/admins */}
        {state.isAdmin && (
          <Box sx={{ mt: 2, p: 1.5, borderRadius: 2, bgcolor: alpha(theme.palette.info.main, 0.04), border: `1px solid ${alpha(theme.palette.info.main, 0.2)}` }}>
            <Typography variant="body2" fontWeight={600} sx={{ mb: 0.5 }}>
              {t("notifyAdminSectionTitle")}
            </Typography>
            <Typography variant="caption" color="text.secondary" component="div">
              {t("notifyAdminSectionDesc")}
            </Typography>
          </Box>
        )}
      </DialogContent>
    </Dialog>
  );
}
