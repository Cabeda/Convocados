import React, { useState, useEffect } from "react";
import {
  Dialog, DialogTitle, DialogContent, Box, Stack, Switch,
  Typography, alpha, useTheme, FormControlLabel, IconButton, Chip,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { useT } from "~/lib/useT";

interface FollowOverrides {
  following: boolean;
  mutePlayerActivity: boolean | null;
  muteReminders: boolean | null;
  mutePostGame: boolean | null;
  muteEventDetails: boolean | null;
  isPlayer?: boolean;
  isAdmin?: boolean;
  pushEnabled?: boolean;
}

type OverrideField = "mutePlayerActivity" | "muteReminders" | "mutePostGame" | "muteEventDetails";

interface Props {
  eventId: string;
  open: boolean;
  onClose: () => void;
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
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
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
