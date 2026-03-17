import React from "react";
import useSWR from "swr";
import {
  Container, Paper, Typography, Stack, Box, Chip, Avatar,
  CircularProgress, Alert, Divider, Tabs, Tab,
} from "@mui/material";
import LocationOnIcon from "@mui/icons-material/LocationOn";
import AccessTimeIcon from "@mui/icons-material/AccessTime";
import SportsIcon from "@mui/icons-material/Sports";
import { ThemeModeProvider } from "./ThemeModeProvider";
import { ResponsiveLayout } from "./ResponsiveLayout";
import { useT } from "~/lib/useT";
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

interface UserProfile {
  user: {
    id: string;
    name: string;
    image: string | null;
    createdAt: string;
  };
  owned: GameSummary[];
  joined: GameSummary[];
  stats: {
    totalGames: number;
    ownedGames: number;
    joinedGames: number;
  };
}

function GameCard({ game }: { game: GameSummary }) {
  const locale = detectLocale();
  const date = new Date(game.dateTime);
  const isPast = date < new Date();
  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, opacity: isPast ? 0.7 : 1 }}>
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

export default function UserProfilePage({ userId }: { userId: string }) {
  const t = useT();
  const locale = detectLocale();
  const [tab, setTab] = React.useState(0);

  const { data, isLoading, error } = useSWR<UserProfile>(
    `/api/users/${userId}`,
    (url: string) => fetch(url).then((r) => {
      if (!r.ok) throw new Error("Not found");
      return r.json();
    }),
  );

  if (isLoading) {
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

  if (error || !data) {
    return (
      <ThemeModeProvider>
        <ResponsiveLayout>
          <Container maxWidth="sm" sx={{ py: 8, textAlign: "center" }}>
            <Typography variant="h5" fontWeight={700} gutterBottom>
              {t("gameNotFound")}
            </Typography>
          </Container>
        </ResponsiveLayout>
      </ThemeModeProvider>
    );
  }

  const { user, owned, joined, stats } = data;
  const memberSince = new Date(user.createdAt);
  const allGames = tab === 0 ? [...owned, ...joined].sort((a, b) => new Date(b.dateTime).getTime() - new Date(a.dateTime).getTime()) : tab === 1 ? owned : joined;

  return (
    <ThemeModeProvider>
      <ResponsiveLayout>
        <Container maxWidth="md" sx={{ py: 4 }}>
          <Stack spacing={3}>
            {/* Profile header */}
            <Paper elevation={2} sx={{ borderRadius: 3, p: { xs: 2, sm: 3 } }}>
              <Stack direction="row" spacing={2} alignItems="center">
                <Avatar
                  src={user.image ?? undefined}
                  sx={{ width: 56, height: 56, fontSize: "1.5rem", bgcolor: "primary.main" }}
                >
                  {user.name[0]?.toUpperCase()}
                </Avatar>
                <Box sx={{ flex: 1 }}>
                  <Typography variant="h5" fontWeight={700}>{user.name}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {t("playerSince", { date: memberSince.toLocaleDateString(locale === "pt" ? "pt-PT" : "en-GB", { month: "long", year: "numeric" }) })}
                  </Typography>
                </Box>
              </Stack>
              <Stack direction="row" spacing={2} sx={{ mt: 2 }}>
                <Chip icon={<SportsIcon />} label={`${stats.totalGames} ${t("gamesPlayed").toLowerCase()}`} variant="outlined" />
                <Chip label={`${stats.ownedGames} ${t("ownedGames").toLowerCase()}`} variant="outlined" size="small" />
                <Chip label={`${stats.joinedGames} ${t("joinedGames").toLowerCase()}`} variant="outlined" size="small" />
              </Stack>
            </Paper>

            {/* Game tabs */}
            <Paper elevation={2} sx={{ borderRadius: 3, overflow: "hidden" }}>
              <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="fullWidth">
                <Tab label={`${t("history")} (${stats.totalGames})`} />
                <Tab label={`${t("ownedGames")} (${stats.ownedGames})`} />
                <Tab label={`${t("joinedGames")} (${stats.joinedGames})`} />
              </Tabs>
              <Box sx={{ p: { xs: 2, sm: 3 } }}>
                {allGames.length > 0 ? (
                  <Stack spacing={1.5}>
                    {allGames.map((g) => <GameCard key={g.id} game={g} />)}
                  </Stack>
                ) : (
                  <Alert severity="info">
                    {tab === 1 ? t("noOwnedGames") : tab === 2 ? t("noJoinedGames") : t("noHistory")}
                  </Alert>
                )}
              </Box>
            </Paper>
          </Stack>
        </Container>
      </ResponsiveLayout>
    </ThemeModeProvider>
  );
}
