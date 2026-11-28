import { Box, Button, Typography } from "@mui/material";
import { useT } from "~/lib/useT";
import { formatMoney, toCents } from "~/lib/money";
import type { RecapTask } from "~/lib/eventStory";
import type { PostGameStatus } from "./postGameStatus";
import { useSelfReport } from "./useSelfReport";

/** On game day the recap is gone; an unpaid share lingers as this one small row. */
export function RecapReminder({ eventId, status, task, onChanged }: {
  eventId: string;
  status: PostGameStatus;
  task: Extract<RecapTask, { kind: "pay" }>;
  onChanged: () => void;
}) {
  const t = useT();
  const { report, busy, failed } = useSelfReport(eventId, status);
  const amount = formatMoney(toCents(task.amount), status.costCurrency);
  return (
    <Box data-testid="recap-reminder" sx={{ display: "flex", alignItems: "center", gap: 1.5, borderLeft: 4, borderColor: "warning.main", borderRadius: 2, bgcolor: "action.hover", pl: 2, pr: 1.5, py: 1 }}>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: "1.0625rem", fontWeight: 700, lineHeight: 1.35 }}>{t("recapReminderTitle", { amount })}</Typography>
        <Typography sx={{ fontSize: "0.875rem", color: "text.secondary", lineHeight: 1.4 }}>{t("recapReminderSub", { payer: task.payerName })}</Typography>
        {failed && <Typography role="alert" sx={{ color: "error.main", fontSize: "0.875rem" }}>{t("recapPayError")}</Typography>}
      </Box>
      <Button
        variant="contained" disableElevation disabled={busy}
        onClick={async () => { if (await report(task.eventPlayerId)) onChanged(); }}
        sx={{ minHeight: 44, minWidth: 44, px: 2.5, borderRadius: 999, fontWeight: 700, textTransform: "none" }}
      >
        {t("recapPayAction")}
      </Button>
    </Box>
  );
}
