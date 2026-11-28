import { Box, Link, Typography } from "@mui/material";
import AccessTimeIcon from "@mui/icons-material/AccessTime";
import LocationOnIcon from "@mui/icons-material/LocationOn";
import { useLocale } from "~/lib/useT";
import { describeRecurrenceRule, parseRecurrenceRule } from "~/lib/recurrence";
import { COMMON_TIMEZONES, formatDateInTz } from "~/lib/timezones";
import { formatMoneyCompact } from "~/lib/money";
import { perPlayerShare } from "~/lib/gameCost";
import type { EventData } from "../types";
import { focusRing, hitArea } from "./styles";
import { useEventPrice } from "./useEventPrice";

interface Props {
  eventId: string;
  event: EventData;
  gameDate: Date;
  canEdit: boolean;
  isAuthenticated: boolean;
}

const line = { display: "flex", alignItems: "flex-start", gap: 0.75, color: "text.secondary", fontSize: "1rem", lineHeight: 1.5, textWrap: "pretty" } as const;
const icon = { fontSize: 20, mt: "2px", flexShrink: 0 } as const;
const link = { color: "primary.main", fontWeight: 600, ...hitArea, ...focusRing } as const;

const mapsHref = (location: string) =>
  /^https?:\/\//i.test(location) ? location : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`;

/**
 * The two quiet lines under the title: when it happens, and where (with what it costs).
 * A weekly game says "Every week on Friday at 20:49", a one-off says the date.
 * The next real date of a weekly game is the next-game block's job, not this line's.
 */
export function EventInfoLines({ eventId, event, gameDate, canEdit, isAuthenticated }: Props) {
  const { locale, t } = useLocale();
  const { loaded, cost } = useEventPrice(eventId, isAuthenticated);

  const time = formatDateInTz(gameDate, locale, event.timezone, { hour: "2-digit", minute: "2-digit" });
  const rule = parseRecurrenceRule(event.recurrenceRule);
  const when = rule
    ? describeRecurrenceRule(rule, locale)
    : formatDateInTz(gameDate, locale, event.timezone, { weekday: "short", day: "numeric", month: "short" });
  const schedule = [
    t("headerWhenAt", { when, time }),
    event.durationMinutes ? t("headerDuration", { n: event.durationMinutes }) : null,
  ].filter(Boolean).join(" · ");

  // The viewer is in another timezone than the game: say which one the time is in.
  const viewerTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const tzLabel = event.timezone && event.timezone !== "UTC" && event.timezone !== viewerTz
    ? COMMON_TIMEZONES.find((tz) => tz.value === event.timezone)?.label ?? event.timezone
    : null;

  const total = cost && cost.totalAmount > 0 ? cost.totalAmount : null;
  const share = total && event.maxPlayers > 0 ? perPlayerShare(total, event.maxPlayers) : null;
  const price = share ? t("priceEach", { amount: formatMoneyCompact(share, cost?.currency, locale) }) : null;
  const askForPrice = canEdit && loaded && !price;
  const showPlace = !!event.location || canEdit || !!price;

  return (
    <Box sx={{ mt: 0.5, display: "grid", gap: 0.25 }}>
      <Box sx={line}>
        <AccessTimeIcon sx={icon} aria-hidden />
        <span>{schedule}{tzLabel && <Box component="span" sx={{ color: "text.disabled" }}> ({tzLabel})</Box>}</span>
      </Box>
      {showPlace && (
        <Box sx={line}>
          <LocationOnIcon sx={icon} aria-hidden />
          <span>
            {event.location
              ? <Link href={mapsHref(event.location)} target="_blank" rel="noopener noreferrer" underline="always" sx={link}>{event.location}</Link>
              : canEdit && <Typography component="span" sx={{ color: "text.disabled", font: "inherit" }}>{t("locationOptional")}</Typography>}
            {price && <>{event.location || canEdit ? " · " : ""}{price}</>}
            {askForPrice && <>{" · "}<Link href={`/events/${eventId}/payments`} underline="always" sx={link}>{t("setPrice")}</Link></>}
          </span>
        </Box>
      )}
    </Box>
  );
}
