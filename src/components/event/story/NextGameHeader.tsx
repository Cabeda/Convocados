import { Box, Typography } from "@mui/material";
import { useLocale } from "~/lib/useT";
import { formatDateInTz } from "~/lib/timezones";
import { countdownOf, isGameDay, type NextGamePhase } from "~/lib/nextGame";
import { NUMERAL_FONT } from "./styles";

interface Props {
  /** `open`, `live` or `signupsSoon` — the phases that show a date. */
  phase: Extract<NextGamePhase, "open" | "live" | "signupsSoon">;
  /** The date of the NEXT game (for a game that has ended, its next occurrence). */
  date: Date;
  timezone: string;
  now: number;
  startMs: number;
}

/**
 * "Next game" over a big condensed date ("Fri 4 Dec · 20:49"). Inside the last day it reads
 * "Game day · Today · 20:49" with a countdown; while it is being played, a "Live now" pill.
 */
export function NextGameHeader({ phase, date, timezone, now, startMs }: Props) {
  const { locale, t } = useLocale();
  const gameDay = phase !== "signupsSoon" && isGameDay(now, startMs, timezone);
  const day = gameDay ? t("ngToday") : formatDateInTz(date, locale, timezone, { weekday: "short", day: "numeric", month: "short" });
  const time = formatDateInTz(date, locale, timezone, { hour: "2-digit", minute: "2-digit" });
  const left = phase === "open" ? countdownOf(startMs - now) : null;

  let sub: string | null = null;
  if (phase === "signupsSoon") sub = t("ngSignupsSoon");
  else if (left) {
    sub = left.hours === 0 ? t("ngStartsInM", { m: left.minutes })
      : left.minutes === 0 ? t("ngStartsInH", { h: left.hours })
        : t("ngStartsInHM", { h: left.hours, m: left.minutes });
  }

  return (
    <Box>
      <Typography id="next-game-heading" component="h2" tabIndex={-1} sx={{ fontSize: "1rem", lineHeight: 1.4, color: "text.secondary", outline: "none", textWrap: "balance" }}>
        {gameDay ? t("ngGameDay") : t("nextGame")}
      </Typography>
      <Typography
        data-testid="next-game-date"
        sx={{ fontFamily: NUMERAL_FONT, fontWeight: 700, fontSize: "2.5rem", lineHeight: 1.05, fontVariantNumeric: "tabular-nums", overflowWrap: "anywhere" }}
      >
        {day} · {time}
      </Typography>
      {phase === "live" && (
        <Box
          data-testid="live-pill"
          sx={{ display: "inline-flex", alignItems: "center", gap: 0.75, mt: 0.75, px: 1.5, minHeight: 28, borderRadius: 999, bgcolor: "primary.main", color: "primary.contrastText", fontSize: "0.875rem", fontWeight: 700 }}
        >
          <Box
            aria-hidden
            sx={{
              width: 8, height: 8, borderRadius: "50%", bgcolor: "currentColor",
              animation: "ngPulse 1600ms ease-in-out infinite",
              "@keyframes ngPulse": { "0%,100%": { opacity: 1 }, "50%": { opacity: 0.35 } },
              "@media (prefers-reduced-motion: reduce)": { animation: "none" },
            }}
          />
          {t("ngLiveNow")}
        </Box>
      )}
      {sub && (
        <Typography data-testid="next-game-sub" sx={{ mt: 0.5, fontSize: "1rem", lineHeight: 1.4, color: "text.secondary", fontVariantNumeric: "tabular-nums", minHeight: "1.4rem" }}>
          {sub}
        </Typography>
      )}
    </Box>
  );
}
