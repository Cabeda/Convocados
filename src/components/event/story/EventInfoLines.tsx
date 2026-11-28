import { Box, Link, Typography } from "@mui/material";
import AccessTimeIcon from "@mui/icons-material/AccessTime";
import LocationOnIcon from "@mui/icons-material/LocationOn";
import { useLocale } from "~/lib/useT";
import { parseRecurrenceRule } from "~/lib/recurrence";
import { COMMON_TIMEZONES } from "~/lib/timezones";
import { formatMoneyCompact } from "~/lib/money";
import { perPlayerShare } from "~/lib/gameCost";
import { scheduleLabel } from "~/lib/eventHeader";
import type { EventData } from "../types";
import { focusRing, hitArea } from "./styles";
import { useEventPrice } from "./useEventPrice";

interface Props {
  eventId: string;
  event: EventData;
  gameDate: Date;
  /** Owner or event admin: may set the price and sees the total. */
  canEdit: boolean;
  /** The server will answer a price request from this viewer (it answers 403 to everyone else). */
  canViewPrice: boolean;
  /** The game is over: a one-off says when it was instead of when it starts. */
  ended: boolean;
  cancelled: boolean;
  /** The game is today: the next-game block says "Today · 20:49", so the time is not said twice here. */
  gameDay?: boolean;
}

const line = { display: "flex", alignItems: "flex-start", gap: 0.75, color: "text.secondary", fontSize: "1rem", lineHeight: 1.5, textWrap: "pretty" } as const;
const icon = { fontSize: 20, mt: "2px", flexShrink: 0 } as const;
const link = { color: "primary.main", fontWeight: 600, ...hitArea, ...focusRing } as const;

const mapsHref = (location: string) =>
  /^https?:\/\//i.test(location) ? location : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`;

/**
 * The two quiet lines under the title: when it happens, and where (with what it costs).
 * A weekly game says "Weekly · Fri 20:49 · 90 min", a one-off says its date, a finished one-off
 * says "Ended Fri, 4 Dec", and a cancelled game says so, with its date struck through.
 * The next real date of a weekly game is the next-game block's job, not this line's.
 */
export function EventInfoLines({ eventId, event, gameDate, canEdit, canViewPrice, ended, cancelled, gameDay = false }: Props) {
  const { locale, t } = useLocale();
  const { loaded, cost } = useEventPrice(eventId, canViewPrice);

  const rule = parseRecurrenceRule(event.recurrenceRule);
  const schedule = scheduleLabel({ rule, gameDate, timezone: event.timezone, durationMinutes: event.durationMinutes, ended: ended && !rule, gameDay: gameDay && !ended && !cancelled, locale }, t);

  // The viewer is in another timezone than the game: say which one the time is in.
  const viewerTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const tzLabel = event.timezone && event.timezone !== "UTC" && event.timezone !== viewerTz
    ? COMMON_TIMEZONES.find((tz) => tz.value === event.timezone)?.label ?? event.timezone
    : null;

  const total = cost && cost.totalAmount > 0 ? cost.totalAmount : null;
  const share = total && event.maxPlayers > 0 ? perPlayerShare(total, event.maxPlayers) : null;
  const money = (n: number) => formatMoneyCompact(n, cost?.currency, locale);
  // A player sees their share; the person who runs the game sees the total as well.
  const price = share
    ? [t("priceEach", { amount: money(share) }), canEdit && total ? t("priceTotal", { amount: money(total) }) : null].filter(Boolean).join(" · ")
    : null;
  const askForPrice = canEdit && loaded && !price;
  // Until the price is known, hold its room with invisible text of about its length: if it will wrap to a
  // second line it does so from the first frame, instead of pushing the page down when it arrives.
  const holdPriceRoom = canViewPrice && !loaded;
  const showPlace = !!event.location || canEdit || !!price || holdPriceRoom;

  return (
    <Box sx={{ mt: 0.5, display: "grid", gap: 0.25 }}>
      <Box sx={line}>
        <AccessTimeIcon sx={icon} aria-hidden />
        <span>
          {cancelled
            ? <><Box component="span" sx={{ fontWeight: 700, color: "text.primary" }}>{t("headerCancelled")}</Box>{" · "}<s>{schedule}</s></>
            : schedule}
          {/* Its own line, so no wrap can strand a "·" at the end of the one above. */}
          {tzLabel && <Box component="span" sx={{ display: "block" }} data-testid="tz-label">{tzLabel}</Box>}
        </span>
      </Box>
      {showPlace && (
        <Box sx={line}>
          <LocationOnIcon sx={icon} aria-hidden />
          {/* Items wrap whole and carry no dots between them, so no line ever ends in a stray "·". */}
          <Box sx={{ display: "flex", flexWrap: "wrap", columnGap: 1.25 }}>
            {event.location
              ? <Link href={mapsHref(event.location)} target="_blank" rel="noopener noreferrer" underline="always" sx={link}>{event.location}</Link>
              : canEdit && <Typography component="span" sx={{ color: "text.secondary", font: "inherit" }}>{t("locationOptional")}</Typography>}
            {price && <Box component="span" sx={{ whiteSpace: "nowrap" }}>{price}</Box>}
            {holdPriceRoom && (
              <Box component="span" aria-hidden data-testid="price-room" sx={{ whiteSpace: "nowrap", visibility: "hidden" }}>
                {[t("priceEach", { amount: money(10) }), canEdit ? t("priceTotal", { amount: money(100) }) : null].filter(Boolean).join(" · ")}
              </Box>
            )}
            {askForPrice && <Link href={`/events/${eventId}/payments`} underline="always" sx={link}>{t("setPrice")}</Link>}
          </Box>
        </Box>
      )}
    </Box>
  );
}
