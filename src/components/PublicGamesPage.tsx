import React from "react";
import useSWR from "swr";
import {
  Container, Paper, Typography, Box, Stack, Chip, Button,
  CircularProgress, alpha, useTheme, Grid2,
} from "@mui/material";
import SportsSoccerIcon from "@mui/icons-material/SportsSoccer";
import LocationOnIcon from "@mui/icons-material/LocationOn";
import AccessTimeIcon from "@mui/icons-material/AccessTime";
import PeopleIcon from "@mui/icons-material/People";
import { ThemeModeProvider } from "./ThemeModeProvider";
import { ResponsiveLayout } from "./ResponsiveLayout";
import { useT } from "~/lib/useT";
import { detectLocale } from "~/lib/i18n";

interface PublicEvent {
  id: string;
  title: string;
  location: string;
  dateTime: string;
  maxPlayers: number;
  playerCount: number;
  spotsLeft: number;
}

export default function PublicGamesPage() {
  const t = useT();
  const theme = useTheme();
  const locale = detectLocale();

  const { data: events, isLoading } = useSWR<PublicEvent[]>(
    "/api/events/public",
    (url) => fetch(url).then((r) => r.json()),
    { refreshInterval: 15000 },
  );

  return (
    <ThemeModeProvider>
      <ResponsiveLayout>
        <Container maxWidth="md" sx={{ py: 6 }}>
          <Stack spacing={4}>
            <Box textAlign="center">
              <SportsSoccerIcon sx={{ fontSize: 56, color: "primary.main", mb: 1 }} />
              <Typography variant="h4" fontWeight={700}>{t("publicGames")}</Typography>
              <Typography variant="body1" color="text.secondary" mt={1}>
                {t("publicGamesSubtitle")}
              </Typography>
            </Box>

            {isLoading && (
              <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
                <CircularProgress />
              </Box>
            )}

            {!isLoading && (!events || events.length === 0) && (
              <Paper elevation={2} sx={{ borderRadius: 3, p: 4, textAlign: "center" }}>
                <Typography variant="h6" color="text.secondary" gutterBottom>
                  {t("noPublicGames")}
                </Typography>
                <Typography variant="body2" color="text.secondary" mb={2}>
                  {t("noPublicGamesDesc")}
                </Typography>
                <Button variant="contained" href="/">{t("createGameBtn")}</Button>
              </Paper>
            )}

            {events && events.length > 0 && (
              <Grid2 container spacing={2}>
                {events.map((ev) => {
                  const date = new Date(ev.dateTime);
                  const isFull = ev.spotsLeft === 0;
                  return (
                    <Grid2 key={ev.id} size={{ xs: 12, sm: 6 }}>
                      <Paper
                        elevation={2}
                        sx={{
                          borderRadius: 3, p: 3, height: "100%",
                          display: "flex", flexDirection: "column", gap: 1.5,
                          transition: "transform 0.15s, box-shadow 0.15s",
                          "&:hover": { transform: "translateY(-2px)", boxShadow: 6 },
                        }}
                      >
                        <Typography variant="h6" fontWeight={700} noWrap>
                          {ev.title}
                        </Typography>

                        <Stack spacing={0.5}>
                          {ev.location && (
                            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                              <LocationOnIcon fontSize="small" color="action" />
                              <Typography variant="body2" color="text.secondary" noWrap>
                                {ev.location}
                              </Typography>
                            </Box>
                          )}
                          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                            <AccessTimeIcon fontSize="small" color="action" />
                            <Typography variant="body2" color="text.secondary">
                              {date.toLocaleString(locale === "pt" ? "pt-PT" : "en-GB", {
                                weekday: "short", month: "short", day: "numeric",
                                hour: "2-digit", minute: "2-digit",
                              })}
                            </Typography>
                          </Box>
                          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                            <PeopleIcon fontSize="small" color="action" />
                            <Typography variant="body2" color="text.secondary">
                              {ev.playerCount}/{ev.maxPlayers}
                            </Typography>
                            {isFull ? (
                              <Chip label="Full" size="small" color="error" sx={{ ml: 0.5 }} />
                            ) : (
                              <Chip
                                label={`${ev.spotsLeft} spot${ev.spotsLeft !== 1 ? "s" : ""} left`}
                                size="small"
                                color="success"
                                sx={{ ml: 0.5 }}
                              />
                            )}
                          </Box>
                        </Stack>

                        <Box sx={{ mt: "auto", pt: 1 }}>
                          <Button
                            variant="contained"
                            fullWidth
                            href={`/events/${ev.id}`}
                            sx={{ borderRadius: 2 }}
                          >
                            {t("joinGame")}
                          </Button>
                        </Box>
                      </Paper>
                    </Grid2>
                  );
                })}
              </Grid2>
            )}
          </Stack>
        </Container>
      </ResponsiveLayout>
    </ThemeModeProvider>
  );
}
