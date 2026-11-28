import { useEffect, useRef } from "react";
import { Box, Button, Link, Typography } from "@mui/material";
import { useLocale } from "~/lib/useT";
import { formatMoneyCompact } from "~/lib/money";
import type { RecapTask } from "~/lib/eventStory";
import { ACTION_HEIGHT, EASE, focusRing, tappable } from "./styles";

export interface RecapReminderProps {
  eventId: string;
  currency: string | null;
  task: Extract<RecapTask, { kind: "pay" }> | null;
  /** The viewer says they paid. */
  onPay: () => void;
  /** The server refused the last try. */
  failed: boolean;
  /** What the viewer just said, once they said it: the row is replaced by this sentence. */
  reported: string | null;
  /** Scroll here and pulse once (the `?action=pay` deep link). */
  highlight?: boolean;
}

const CALM = "@media (prefers-reduced-motion: reduce)";

/** On game day the recap is gone; an unpaid share lingers as this one small row. */
export function RecapReminder({ eventId, currency, task, onPay, failed, reported, highlight }: RecapReminderProps) {
  const { locale, t } = useLocale();
  const ref = useRef<HTMLDivElement>(null);
  const amount = formatMoneyCompact(task?.amount ?? 0, currency, locale);

  useEffect(() => {
    if (!highlight) return;
    const calm = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    ref.current?.scrollIntoView?.({ block: "center", behavior: calm ? "auto" : "smooth" });
  }, [highlight]);

  return (
    <Box
      ref={ref} data-testid="recap-reminder"
      sx={{
        display: "flex", flexWrap: "wrap", alignItems: "center", gap: 1.5, borderRadius: 2, bgcolor: "action.hover", pl: 2, pr: 1.5, py: 1, position: "relative",
        "&::before": { content: '""', position: "absolute", left: 0, top: 0, bottom: 0, width: 5, bgcolor: "attention.main", borderRight: "1px solid", borderColor: "attention.ring" },
        ...(highlight ? {
          animation: `recapPulse 1200ms ${EASE}`,
          "@keyframes recapPulse": { "0%,100%": { opacity: 1 }, "35%": { opacity: 0.6 } },
          [CALM]: { animation: "none" },
        } : {}),
      }}
    >
      <Box sx={{ flex: "1 1 10rem", minWidth: 0 }} {...(reported ? { role: "status" } : {})}>
        <Typography sx={{ fontSize: "1.0625rem", fontWeight: 700, lineHeight: 1.35 }}>{reported ?? t("recapReminderTitle", { amount })}</Typography>
        {!reported && <Typography sx={{ fontSize: "0.875rem", color: "text.secondary", lineHeight: 1.4 }}>{t("recapReminderSub", { payer: task?.payerName ?? "" })}</Typography>}
        {failed && !reported && <Typography role="alert" sx={{ color: "error.main", fontSize: "0.9375rem" }}>{t("recapPayError")}</Typography>}
        <Link
          href={`/events/${eventId}/payments`} underline="always"
          sx={{ display: "inline-flex", alignItems: "center", minHeight: 44, fontSize: "0.9375rem", fontWeight: 700, borderRadius: 1, ...focusRing }}
        >
          {t("recapLinkPayments")}
        </Link>
      </Box>
      {!reported && (
        <Button
          variant="contained" disableElevation onClick={onPay}
          sx={{ minHeight: ACTION_HEIGHT, minWidth: 44, px: 2.5, ml: "auto", borderRadius: 999, fontWeight: 700, textTransform: "none", whiteSpace: "nowrap", ...tappable }}
        >
          {t("recapPayAction")}
        </Button>
      )}
    </Box>
  );
}
