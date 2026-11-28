import { Typography } from "@mui/material";
import { useLocale } from "~/lib/useT";
import { formatDateInTz } from "~/lib/timezones";

/**
 * TODO(slice-3): delete this line. The next-game block owns the date, the countdown
 * (under 24 h) and the live pill; this only keeps the date on the page until it exists.
 */
export function NextGameDateTemp({ date, timezone }: { date: Date; timezone: string }) {
  const { locale, t } = useLocale();
  const day = formatDateInTz(date, locale, timezone, { weekday: "short", day: "numeric", month: "short" });
  const time = formatDateInTz(date, locale, timezone, { hour: "2-digit", minute: "2-digit" });
  return (
    <Typography sx={{ fontSize: "1rem", color: "text.secondary", fontVariantNumeric: "tabular-nums" }}>
      {t("nextGame")} · {day} · {time}
    </Typography>
  );
}
