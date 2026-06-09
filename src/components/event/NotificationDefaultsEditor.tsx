import React, { useState, useEffect } from "react";
import { Stack, Switch, FormControlLabel, Typography, Snackbar } from "@mui/material";
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

export function NotificationDefaultsEditor({ eventId, canEdit }: Props) {
  const t = useT();
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
    const newValue = current ? null : true; // false/undefined → mute (true), true → unmute (null)
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

  return (
    <>
      <Stack spacing={0.5}>
        <FormControlLabel
          control={<Switch size="small" checked={!defaults.mutePlayerActivity} onChange={() => toggle("mutePlayerActivity")} disabled={!canEdit} />}
          label={<Typography variant="body2">{t("playerActivity")}</Typography>}
        />
        <FormControlLabel
          control={<Switch size="small" checked={!defaults.muteReminders} onChange={() => toggle("muteReminders")} disabled={!canEdit} />}
          label={<Typography variant="body2">{t("gameReminders")}</Typography>}
        />
        <FormControlLabel
          control={<Switch size="small" checked={!defaults.mutePostGame} onChange={() => toggle("mutePostGame")} disabled={!canEdit} />}
          label={<Typography variant="body2">{t("postGameResults")}</Typography>}
        />
        <FormControlLabel
          control={<Switch size="small" checked={!defaults.muteEventDetails} onChange={() => toggle("muteEventDetails")} disabled={!canEdit} />}
          label={<Typography variant="body2">{t("eventDetails")}</Typography>}
        />
      </Stack>
      <Snackbar open={!!snackbar} autoHideDuration={3000} onClose={() => setSnackbar(null)} message={snackbar} />
    </>
  );
}
