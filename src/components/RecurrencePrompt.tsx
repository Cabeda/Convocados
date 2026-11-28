import { useState } from "react";
import { Paper, Box, Typography, Button, Stack, Chip, Alert } from "@mui/material";
import RepeatIcon from "@mui/icons-material/Repeat";
import { useT } from "~/lib/useT";
import { apiRequest } from "~/lib/api/client";

interface Props {
  eventId: string;
  /** Whether the Event already recurs — shows the settled state instead of the offer. */
  isRecurring: boolean;
  /** True once this Game's wrap-up is fully done: the moment the offer is relevant. */
  complete: boolean;
  /** No border of its own: it sits on the page background under the recap card (one card per page). */
  flat?: boolean;
}

/** Flat: the same content on the page background instead of in a card of its own. */
function Shell({ children, testId, flat }: { children: React.ReactNode; testId: string; flat: boolean }) {
  return flat
    ? <Box data-testid={testId} sx={{ px: 0.5, py: 1, width: "100%" }}>{children}</Box>
    : <Paper data-testid={testId} variant="outlined" sx={{ p: 1.5, mt: 1, width: "100%" }}>{children}</Paper>;
}

/**
 * Post-game "same again next week?" — the Owner's one-tap path to recurrence,
 * which until now could only be set at creation time.
 *
 * Weekly without an explicit byDay keeps the Event's own weekday (see
 * recurrence.nextOccurrence), so this stays a single, honest CTA.
 */
export function RecurrencePrompt({ eventId, isRecurring, complete, flat = false }: Props) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (isRecurring || done) {
    return (
      <Shell flat={flat} testId={done && !isRecurring ? "recurrence-done" : "recurrence-already"}>
        <Stack direction="row" spacing={1} alignItems="center">
          <Chip size="small" color="primary" icon={<RepeatIcon />} label={t("recurrenceWeeklyLabel")} />
          <Typography variant="caption" color="text.secondary">
            {done && !isRecurring ? t("recurrenceDone") : t("recurrenceAlreadyOn")}
          </Typography>
        </Stack>
      </Shell>
    );
  }

  if (!complete) return null;

  const makeWeekly = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiRequest("PUT /api/events/{id}/recurrence", {
        params: { id: eventId },
        body: { isRecurring: true, recurrenceFreq: "weekly", recurrenceInterval: 1 },
      });
      setDone(true);
    } catch {
      setError(t("recurrenceFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell flat={flat} testId="recurrence-prompt">
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
    </Shell>
  );
}
