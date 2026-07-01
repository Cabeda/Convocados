import React, { useState, useEffect } from "react";
import { Stack, Switch, FormControlLabel, Typography, Snackbar, Box, alpha, useTheme } from "@mui/material";
import { useT } from "~/lib/useT";

interface Defaults {
  mutePlayerActivity?: boolean;
  muteReminders?: boolean;
  mutePostGame?: boolean;
  muteEventDetails?: boolean;
}

interface Props {
  eventId: string;
  canEdit: boolean;
}

/**
 * ponytail: Notification settings with descriptions.
 * Used in event settings page (organizer defaults) and can be reused for user overrides.
 * Each toggle explains what it does and when it fires.
 */
export function NotificationDefaultsEditor({ eventId, canEdit }: Props) {
  const t = useT();
  const theme = useTheme();
  const [defaults, setDefaults] = useState<Defaults>({});
  const [snackbar, setSnackbar] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/events/${eventId}/notification-defaults`)
      .then(r => r.json())
      .then(d => setDefaults(d))
      .catch(() => {});
  }, [eventId]);

  const toggle = async (field: keyof Defaults) => {
    const current = defaults[field] ?? false;
    const newValue = current ? null : true;
    const updated = { ...defaults, [field]: newValue ?? undefined };
    if (newValue === null) delete updated[field];
    setDefaults(updated);

    try {
      const res = await fetch(`/api/events/${eventId}/notification-defaults`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: newValue }),
      });
      if (res.ok) {
        setSnackbar(t("notificationsSaved"));
      }
    } catch {
      setSnackbar(t("notificationsSaveError"));
    }
  };

  const items: Array<{ field: keyof Defaults; label: string; description: string }> = [
    {
      field: "muteReminders",
      label: t("gameReminders"),
      description: t("notifyDescReminders"),
    },
    {
      field: "mutePlayerActivity",
      label: t("playerActivity"),
      description: t("notifyDescPlayerActivity"),
    },
    {
      field: "mutePostGame",
      label: t("postGameResults"),
      description: t("notifyDescPostGame"),
    },
    {
      field: "muteEventDetails",
      label: t("eventDetails"),
      description: t("notifyDescEventDetails"),
    },
  ];

  return (
    <>
      <Stack spacing={1}>
        {items.map(({ field, label, description }) => {
          const enabled = !defaults[field];
          return (
            <Box
              key={field}
              sx={{
                display: "flex", alignItems: "flex-start", gap: 1.5,
                p: 1.5, borderRadius: 2,
                bgcolor: enabled ? alpha(theme.palette.success.main, 0.04) : alpha(theme.palette.action.hover, 0.03),
                border: `1px solid ${enabled ? alpha(theme.palette.success.main, 0.2) : alpha(theme.palette.divider, 0.5)}`,
                transition: "all 0.15s",
              }}
            >
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" fontWeight={600}>
                  {label}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {description}
                </Typography>
              </Box>
              <FormControlLabel
                control={
                  <Switch
                    size="small"
                    checked={enabled}
                    onChange={() => toggle(field)}
                    disabled={!canEdit}
                  />
                }
                label=""
                sx={{ m: 0, mr: -0.5 }}
              />
            </Box>
          );
        })}
      </Stack>
      <Snackbar open={!!snackbar} autoHideDuration={3000} onClose={() => setSnackbar(null)} message={snackbar} />
    </>
  );
}
