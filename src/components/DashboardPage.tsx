import React from "react";
import useSWR from "swr";
import {
  Container, Paper, Typography, Stack, Box, Chip, Button,
  CircularProgress, Alert, Divider,
} from "@mui/material";
import SportsSoccerIcon from "@mui/icons-material/SportsSoccer";
import LocationOnIcon from "@mui/icons-material/LocationOn";
import AccessTimeIcon from "@mui/icons-material/AccessTime";
import { ThemeModeProvider } from "./ThemeModeProvider";
import { ResponsiveLayout } from "./ResponsiveLayout";
import { useT } from "~/lib/useT";
import { useSession } from "~/lib/auth.client";
import { detectLocale } from "~/lib/i18n";

interface GameSummary {
  id: string;
  title: string;
  location: string;
  dateTime: string;
  sport: string;
  maxPlayers: number;
  playerCount: number;
}

interface DashboardData {
  owned: GameSummary[];
  joined: GameSummary[];
}

function GameCard({ game }: { game: GameSummary }) {
  const locale = detectLocale();
  const date = new Date(game.dateTime);
  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
      <Stack spacing={1}>
        <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Typography variant="subtitle1" fontWeight={600}>
            <a href={`/events/${game.id}`} style={{ textDecoration: "none", color: "inherit" }}>
              {game.title}
            </a>
          </Typography>
          <Chip
            label={`${game.playerCount}/${game.maxPlayers}`}
            size="small"
            color={game.playerCount >= game.maxPlayers ? "warning" : "primary"}
          />
        </Box>
        <Stack direction="row" spacing={2} sx={{ flexWrap: "wrap" }}>
          {game.location && (
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
              <LocationOnIcon fontSize="small" color="action" />
              <Typography variant="body2" color="text.secondary">{game.location}</Typography>
            </Box>
          )}
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
            <AccessTimeIcon fontSize="small" color="action" />
            <Typography variant="body2" color="text.secondary">
              {date.toLocaleString(locale === "pt" ? "pt-PT" : "en-GB", {
                weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
              })}
            </Typography>
          </Box>
        </Stack>
      </Stack>
    </Paper>
  );
}

export default function DashboardPage() {
  const t = useT();
  const { data: session, isPending: sessionLoading } = useSession();

  const { data, isLoading } = useSWR<DashboardData>(
    session?.user ? "/api/me/games" : null,
    (url: string) => fetch(url).then((r) => r.json()),
  );

  if (sessionLoading) {
    return (
      <ThemeModeProvider>
        <ResponsiveLayout>
          <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
            <CircularProgress />
          </Box>
        </ResponsiveLayout>
      </ThemeModeProvider>
    );
  }

  if (!session?.user) {
    return (
      <ThemeModeProvider>
        <ResponsiveLayout>
          <Container maxWidth="sm" sx={{ py: 8, textAlign: "center" }}>
            <Typography variant="h5" fontWeight={700} gutterBottom>
              {t("myGames")}
            </Typography>
            <Typography color="text.secondary" gutterBottom>
              {t("signIn")}
            </Typography>
            <Button variant="contained" href="/auth/signin" sx={{ mt: 2 }}>
              {t("signIn")}
            </Button>
          </Container>
        </ResponsiveLayout>
      </ThemeModeProvider>
    );
  }

  return (
    <ThemeModeProvider>
      <ResponsiveLayout>
        <Container maxWidth="md" sx={{ py: 4 }}>
          <Stack spacing={4}>
            <Typography variant="h4" fontWeight={700}>{t("myGames")}</Typography>

            {isLoading ? (
              <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
                <CircularProgress />
              </Box>
            ) : (
              <>
                {/* Owned games */}
                <Box>
                  <Typography variant="h6" fontWeight={600} gutterBottom>
                    {t("ownedGames")}
                  </Typography>
                  {data?.owned && data.owned.length > 0 ? (
                    <Stack spacing={1.5}>
                      {data.owned.map((g) => <GameCard key={g.id} game={g} />)}
                    </Stack>
                  ) : (
                    <Alert severity="info">{t("noOwnedGames")}</Alert>
                  )}
                </Box>

                <Divider />

                {/* Joined games */}
                <Box>
                  <Typography variant="h6" fontWeight={600} gutterBottom>
                    {t("joinedGames")}
                  </Typography>
                  {data?.joined && data.joined.length > 0 ? (
                    <Stack spacing={1.5}>
                      {data.joined.map((g) => <GameCard key={g.id} game={g} />)}
                    </Stack>
                  ) : (
                    <Alert severity="info">{t("noJoinedGames")}</Alert>
                  )}
                </Box>
              </>
            )}
          </Stack>
        </Container>
      </ResponsiveLayout>
    </ThemeModeProvider>
  );
}
