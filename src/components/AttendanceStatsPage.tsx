import React, { useState, useEffect } from "react";
import {
  Container, Paper, Typography, Box, Stack, Button,
  CircularProgress, Alert, Chip, alpha, useTheme,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import EmojiEventsIcon from "@mui/icons-material/EmojiEvents";
import { ThemeModeProvider } from "./ThemeModeProvider";
import { ResponsiveLayout } from "./ResponsiveLayout";
import { useT } from "~/lib/useT";
import { detectLocale } from "~/lib/i18n";

interface AttendanceRecord {
  name: string;
  gamesPlayed: number;
  totalGames: number;
  attendanceRate: number;
  currentStreak: number;
  lastPlayed: string | null;
}

interface AttendanceData {
  players: AttendanceRecord[];
  totalGames: number;
}

function AttendanceBadge({ rate }: { rate: number }) {
  const t = useT();
  if (rate >= 0.8) return <Chip label={t("attendanceHigh")} size="small" color="success" variant="outlined" />;
  if (rate >= 0.5) return <Chip label={t("attendanceMedium")} size="small" color="warning" variant="outlined" />;
  return <Chip label={t("attendanceLow")} size="small" color="error" variant="outlined" />;
}

function AttendanceBar({ rate }: { rate: number }) {
  const theme = useTheme();
  const color = rate >= 0.8
    ? theme.palette.success.main
    : rate >= 0.5
      ? theme.palette.warning.main
      : theme.palette.error.main;

  return (
    <Box sx={{ width: "100%", height: 6, borderRadius: 3, bgcolor: alpha(color, 0.15) }}>
      <Box sx={{ width: `${Math.round(rate * 100)}%`, height: "100%", borderRadius: 3, bgcolor: color, transition: "width 0.3s" }} />
    </Box>
  );
}

function PlayerRow({ player }: { player: AttendanceRecord }) {
  const t = useT();
  const locale = detectLocale();
  const pct = `${Math.round(player.attendanceRate * 100)}%`;
  const lastDate = player.lastPlayed
    ? new Date(player.lastPlayed).toLocaleDateString(locale === "pt" ? "pt-PT" : locale === "es" ? "es-ES" : locale === "fr" ? "fr-FR" : locale === "de" ? "de-DE" : locale === "it" ? "it-IT" : "en-GB", { day: "numeric", month: "short" })
    : "—";

  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
      <Stack spacing={1}>
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Typography variant="subtitle2" fontWeight={600}>{player.name}</Typography>
          <AttendanceBadge rate={player.attendanceRate} />
        </Stack>
        <AttendanceBar rate={player.attendanceRate} />
        <Stack direction="row" spacing={2} flexWrap="wrap" sx={{ "& > *": { minWidth: "fit-content" } }}>
          <Typography variant="caption" color="text.secondary">
            {pct} ({player.gamesPlayed}/{player.totalGames})
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {t("currentStreak")}: {player.currentStreak}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {t("lastPlayed")}: {lastDate}
          </Typography>
        </Stack>
      </Stack>
    </Paper>
  );
}

export default function AttendanceStatsPage({ eventId }: { eventId: string }) {
  const t = useT();
  const [data, setData] = useState<AttendanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch(`/api/events/${eventId}/attendance`)
      .then((r) => {
        if (!r.ok) throw new Error("Not found");
        return r.json();
      })
      .then(setData)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [eventId]);

  return (
    <ThemeModeProvider>
      <ResponsiveLayout>
        <Container maxWidth="md" sx={{ py: 4 }}>
          <Stack spacing={3}>
            {/* Header */}
            <Stack direction="row" alignItems="center" spacing={1}>
              <Button
                href={`/events/${eventId}`}
                startIcon={<ArrowBackIcon />}
                size="small"
              >
                {t("backToGame")}
              </Button>
            </Stack>

            <Stack direction="row" alignItems="center" spacing={1}>
              <EmojiEventsIcon color="primary" />
              <Typography variant="h5" fontWeight={700}>{t("attendanceStats")}</Typography>
            </Stack>
            <Typography variant="body2" color="text.secondary">{t("attendanceStatsDesc")}</Typography>

            {loading && (
              <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
                <CircularProgress />
              </Box>
            )}

            {error && (
              <Alert severity="error">{t("gameNotFound")}</Alert>
            )}

            {data && data.totalGames === 0 && (
              <Alert severity="info">
                <Typography variant="subtitle2" fontWeight={600}>{t("noAttendanceData")}</Typography>
                <Typography variant="body2">{t("noAttendanceDataDesc")}</Typography>
              </Alert>
            )}

            {data && data.totalGames > 0 && (
              <>
                <Chip
                  label={`${t("totalGamesPlayed")}: ${data.totalGames}`}
                  variant="outlined"
                  size="small"
                  sx={{ alignSelf: "flex-start" }}
                />
                <Stack spacing={1.5}>
                  {data.players.map((p) => (
                    <PlayerRow key={p.name} player={p} />
                  ))}
                </Stack>
              </>
            )}
          </Stack>
        </Container>
      </ResponsiveLayout>
    </ThemeModeProvider>
  );
}
