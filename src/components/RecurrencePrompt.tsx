import { useState } from "react";
import { Paper, Typography, Button, Stack, Chip, Alert } from "@mui/material";
import RepeatIcon from "@mui/icons-material/Repeat";
import { useT } from "~/lib/useT";

interface Props {
  eventId: string;
  /** Whether the Event already recurs — shows the settled state instead of the offer. */
  isRecurring: boolean;
  /** True once this Game's wrap-up is fully done: the moment the offer is relevant. */
  complete: boolean;
}

/**
 * Post-game "same again next week?" — the Owner's one-tap path to recurrence,
 * which until now could only be set at creation time.
 *
 * Weekly without an explicit byDay keeps the Event's own weekday (see
 * recurrence.nextOccurrence), so this stays a single, honest CTA.
 */
export function RecurrencePrompt({ eventId, isRecurring, complete }: Props) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (isRecurring || done) {
    return (
      <Paper
        data-testid={done && !isRecurring ? "recurrence-done" : "recurrence-already"}
        variant="outlined"
        sx={{ p: 1.5, mt: 1, width: "100%" }}
      >
        <Stack direction="row" spacing={1} alignItems="center">
          <Chip size="small" color="primary" icon={<RepeatIcon />} label={t("recurrenceWeeklyLabel")} />
          <Typography variant="caption" color="text.secondary">
            {done && !isRecurring ? t("recurrenceDone") : t("recurrenceAlreadyOn")}
          </Typography>
        </Stack>
      </Paper>
    );
  }

  if (!complete) return null;

  const makeWeekly = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/events/${eventId}/recurrence`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isRecurring: true, recurrenceFreq: "weekly", recurrenceInterval: 1 }),
      });
      if (!res.ok) throw new Error("failed");
      setDone(true);
    } catch {
      setError(t("recurrenceFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Paper data-testid="recurrence-prompt" variant="outlined" sx={{ p: 1.5, mt: 1, width: "100%" }}>
      <Typography variant="body2" fontWeight={600} gutterBottom>
        {t("recurrencePromptTitle")}
      </Typography>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
        {t("recurrencePromptBody")}
      </Typography>
      {error && (
        <Alert severity="error" data-testid="recurrence-error" sx={{ mb: 1 }}>
          {error}
        </Alert>
      )}
      <Stack direction="row" spacing={1}>
        <Button
          data-testid="recurrence-weekly"
          variant="contained"
          size="small"
          startIcon={<RepeatIcon />}
          disabled={busy}
          onClick={makeWeekly}
        >
          {t("recurrenceMakeWeekly")}
        </Button>
      </Stack>
    </Paper>
  );
}
