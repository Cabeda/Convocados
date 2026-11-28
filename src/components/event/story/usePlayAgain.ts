import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { apiRequest } from "~/lib/api/client";
import { buildRecurrenceRule, serializeRecurrenceRule } from "~/lib/recurrence";
import { formatDateInTz } from "~/lib/timezones";
import type { Locale } from "~/lib/i18n";
import type { EventData } from "../types";

interface Input {
  event: EventData;
  setEvent: Dispatch<SetStateAction<EventData | null>>;
  refetch: () => Promise<void>;
  beginWrite: () => () => void;
  notify: (message: string) => void;
  locale: Locale;
  words: { failed: string; now: (day: string) => string };
}

/**
 * "Make it weekly" after a one-off game. The page shows the next game at once; if the server says no, the old
 * page comes back with a sentence. `worked` is true once it worked, so the next game can take focus once it is there.
 */
export function usePlayAgain({ event, setEvent, refetch, beginWrite, notify, locale, words }: Input) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [worked, setWorked] = useState(false);
  const inFlight = useRef(false);

  const makeWeekly = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    const before = { isRecurring: event.isRecurring, recurrenceRule: event.recurrenceRule };
    const rule = serializeRecurrenceRule(buildRecurrenceRule({ freq: "weekly", interval: 1 }, new Date(event.dateTime), event.timezone));
    setBusy(true);
    setError(null);
    setEvent((e) => (e ? { ...e, isRecurring: true, recurrenceRule: rule } : e));
    const end = beginWrite();
    try {
      await apiRequest("PUT /api/events/{id}/recurrence", {
        params: { id: event.id }, body: { isRecurring: true, recurrenceFreq: "weekly", recurrenceInterval: 1 },
      });
      end();
      setWorked(true);
      notify(words.now(formatDateInTz(new Date(event.dateTime), locale, event.timezone, { weekday: "long" })));
      await refetch();
    } catch {
      end();
      setEvent((e) => (e ? { ...e, ...before } : e));
      setError(words.failed);
    } finally {
      setBusy(false);
      inFlight.current = false;
    }
  }, [event, setEvent, refetch, beginWrite, notify, locale, words]);

  return { busy, error, makeWeekly, worked, ack: () => setWorked(false), clearError: () => setError(null) };
}
