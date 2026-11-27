import { useState, useEffect } from "react";
import { Stack, Switch, FormControlLabel, Typography, Alert, Snackbar, CircularProgress } from "@mui/material";
import { useT } from "~/lib/useT";
import { apiRequest } from "~/lib/api/client";

interface ReminderTimings {
  reminder24h: boolean;
  reminder2h: boolean;
  reminder1h: boolean;
}

const FIELDS = ["reminder24h", "reminder2h", "reminder1h"] as const;
type Field = (typeof FIELDS)[number];

const LABELS = {
  reminder24h: "reminder24hLabel",
  reminder2h: "reminder2hLabel",
  reminder1h: "reminder1hLabel",
} as const;

interface Props {
  eventId: string;
  canEdit: boolean;
}

/**
 * Per-event reminder gates (Event.reminder24h/2h/1h). The route has existed as
 * the only writer since the 2026-10-13 migration; this is the organizer's
 * surface for it. A failed GET leaves the switches disabled rather than letting
 * a mount write the defaults over the stored row.
 */
export function EventReminderTimings({ eventId, canEdit }: Props) {
  const t = useT();
  const [timings, setTimings] = useState<ReminderTimings | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [snackbar, setSnackbar] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiRequest("GET /api/events/{id}/reminder-timings", { params: { id: eventId } })
      .then((body) => {
        if (cancelled) return;
        const data = body as Partial<ReminderTimings>;
        setTimings({
          reminder24h: data.reminder24h === true,
          reminder2h: data.reminder2h === true,
          reminder1h: data.reminder1h === true,
        });
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  const toggle = async (field: Field) => {
    if (!timings || saving) return;
    const previous = timings;
    const value = !timings[field];
    setTimings({ ...timings, [field]: value });
    setSaving(true);
    try {
      const updated = (await apiRequest("PUT /api/events/{id}/reminder-timings", {
        params: { id: eventId },
        body: { [field]: value },
      })) as ReminderTimings;
      setTimings(updated);
      setSnackbar(t("notificationsSaved"));
    } catch {
      setTimings(previous);
      setSnackbar(t("notificationsSaveError"));
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) return <CircularProgress size={20} />;

  const allOff = !!timings && !timings.reminder24h && !timings.reminder2h && !timings.reminder1h;

  return (
    <>
      <Stack spacing={1}>
        <Typography variant="body2" color="text.secondary">
          {t("eventReminderTimingsDesc")}
        </Typography>
        {FIELDS.map((field) => (
          <FormControlLabel
            key={field}
            control={
              <Switch
                size="small"
                checked={timings?.[field] ?? false}
                onChange={() => toggle(field)}
                disabled={!canEdit || saving || failed || !timings}
              />
            }
            label={<Typography variant="body2">{t(LABELS[field])}</Typography>}
          />
        ))}
        {allOff && <Alert severity="info">{t("eventReminderAllOff")}</Alert>}
      </Stack>
      <Snackbar open={!!snackbar} autoHideDuration={3000} onClose={() => setSnackbar(null)} message={snackbar} />
    </>
  );
}
