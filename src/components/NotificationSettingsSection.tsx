import React, { useState, useEffect } from "react";
import {
  Paper, Typography, Stack, Switch, FormControlLabel,
  Divider, Snackbar, CircularProgress,
} from "@mui/material";
import NotificationsIcon from "@mui/icons-material/Notifications";
import { useT } from "~/lib/useT";
import { DEFAULTS } from "~/lib/notificationPrefsDefaults";

type Prefs = typeof DEFAULTS;

export function NotificationSettingsSection() {
  const t = useT();
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [snackbar, setSnackbar] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/me/notification-preferences")
      .then((r) => r.json())
      .then((data) => {
        const merged: Prefs = { ...DEFAULTS };
        for (const key of Object.keys(DEFAULTS) as (keyof Prefs)[]) {
          if (typeof data[key] === "boolean") merged[key] = data[key];
        }
        setPrefs(merged);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const toggle = async (field: keyof Prefs) => {
    const newValue = !prefs[field];
    const updated = { ...prefs, [field]: newValue };
    setPrefs(updated);
    setSaving(true);
    try {
      const res = await fetch("/api/me/notification-preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: newValue }),
      });
      if (!res.ok) {
        setPrefs(prefs);
        setSnackbar(t("notificationsSaveError"));
      } else {
        setSnackbar(t("notificationsSaved"));
      }
    } catch {
      setPrefs(prefs);
      setSnackbar(t("notificationsSaveError"));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Paper elevation={2} sx={{ borderRadius: 3, p: { xs: 2, sm: 3 }, display: "flex", justifyContent: "center" }}>
        <CircularProgress size={24} />
      </Paper>
    );
  }

  return (
    <>
      <Paper elevation={2} sx={{ borderRadius: 3, p: { xs: 2, sm: 3 } }}>
        <Stack spacing={2}>
          <Stack direction="row" alignItems="center" spacing={1}>
            <NotificationsIcon fontSize="small" color="action" />
            <Typography variant="h6" fontWeight={600}>{t("notificationSettings")}</Typography>
          </Stack>
          <Typography variant="body2" color="text.secondary">{t("notificationSettingsDesc")}</Typography>

          {/* Global toggles */}
          <Stack spacing={0.5}>
            <FormControlLabel
              control={<Switch checked={prefs.emailEnabled} onChange={() => toggle("emailEnabled")} disabled={saving} />}
              label={t("emailNotifications")}
            />
            <FormControlLabel
              control={<Switch checked={prefs.pushEnabled} onChange={() => toggle("pushEnabled")} disabled={saving} />}
              label={t("pushNotifications")}
            />
          </Stack>

          <Divider />

          {/* Game invites */}
          <Typography variant="subtitle2" fontWeight={600}>{t("gameInvites")}</Typography>
          <Stack spacing={0.5} sx={{ pl: 1 }}>
            <FormControlLabel
              control={<Switch checked={prefs.gameInviteEmail} onChange={() => toggle("gameInviteEmail")} disabled={saving || !prefs.emailEnabled} size="small" />}
              label={t("emailNotifications")}
            />
            <FormControlLabel
              control={<Switch checked={prefs.gameInvitePush} onChange={() => toggle("gameInvitePush")} disabled={saving || !prefs.pushEnabled} size="small" />}
              label={t("pushNotifications")}
            />
          </Stack>

          {/* Player activity */}
          <Typography variant="subtitle2" fontWeight={600}>{t("playerActivity")}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ pl: 1, mt: -1 }}>{t("playerActivityDesc")}</Typography>
          <Stack spacing={0.5} sx={{ pl: 1 }}>
            <FormControlLabel
              control={<Switch checked={prefs.playerActivityPush} onChange={() => toggle("playerActivityPush")} disabled={saving || !prefs.pushEnabled} size="small" />}
              label={t("pushNotifications")}
            />
          </Stack>

          {/* Event detail changes */}
          <Typography variant="subtitle2" fontWeight={600}>{t("eventDetails")}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ pl: 1, mt: -1 }}>{t("eventDetailsDesc")}</Typography>
          <Stack spacing={0.5} sx={{ pl: 1 }}>
            <FormControlLabel
              control={<Switch checked={prefs.eventDetailsPush} onChange={() => toggle("eventDetailsPush")} disabled={saving || !prefs.pushEnabled} size="small" />}
              label={t("pushNotifications")}
            />
          </Stack>

          {/* Game reminders */}
          <Typography variant="subtitle2" fontWeight={600}>{t("gameReminders")}</Typography>
          <Stack spacing={0.5} sx={{ pl: 1 }}>
            <FormControlLabel
              control={<Switch checked={prefs.gameReminderEmail} onChange={() => toggle("gameReminderEmail")} disabled={saving || !prefs.emailEnabled} size="small" />}
              label={t("emailNotifications")}
            />
            <FormControlLabel
              control={<Switch checked={prefs.gameReminderPush} onChange={() => toggle("gameReminderPush")} disabled={saving || !prefs.pushEnabled} size="small" />}
              label={t("pushNotifications")}
            />
          </Stack>

          {/* Weekly summary */}
          <Typography variant="subtitle2" fontWeight={600}>{t("weeklySummary")}</Typography>
          <Stack spacing={0.5} sx={{ pl: 1 }}>
            <FormControlLabel
              control={<Switch checked={prefs.weeklySummaryEmail} onChange={() => toggle("weeklySummaryEmail")} disabled={saving || !prefs.emailEnabled} size="small" />}
              label={t("emailNotifications")}
            />
          </Stack>

          {/* Payment reminders */}
          <Typography variant="subtitle2" fontWeight={600}>{t("paymentReminders")}</Typography>
          <Stack spacing={0.5} sx={{ pl: 1 }}>
            <FormControlLabel
              control={<Switch checked={prefs.paymentReminderEmail} onChange={() => toggle("paymentReminderEmail")} disabled={saving || !prefs.emailEnabled} size="small" />}
              label={t("emailNotifications")}
            />
            <FormControlLabel
              control={<Switch checked={prefs.paymentReminderPush} onChange={() => toggle("paymentReminderPush")} disabled={saving || !prefs.pushEnabled} size="small" />}
              label={t("pushNotifications")}
            />
          </Stack>

          <Divider />

          {/* Reminder timing */}
          <Typography variant="subtitle2" fontWeight={600}>{t("reminderTiming")}</Typography>
          <Stack spacing={0.5} sx={{ pl: 1 }}>
            <FormControlLabel
              control={<Switch checked={prefs.reminder24h} onChange={() => toggle("reminder24h")} disabled={saving} size="small" />}
              label={t("reminder24hLabel")}
            />
            <FormControlLabel
              control={<Switch checked={prefs.reminder2h} onChange={() => toggle("reminder2h")} disabled={saving} size="small" />}
              label={t("reminder2hLabel")}
            />
            <FormControlLabel
              control={<Switch checked={prefs.reminder1h} onChange={() => toggle("reminder1h")} disabled={saving} size="small" />}
              label={t("reminder1hLabel")}
            />
          </Stack>
        </Stack>
      </Paper>

      <Snackbar
        open={!!snackbar}
        autoHideDuration={3000}
        onClose={() => setSnackbar(null)}
        message={snackbar}
      />
    </>
  );
}
