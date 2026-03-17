import React, { useState } from "react";
import useSWR from "swr";
import {
  Container, Paper, Typography, Stack, Box, Chip, Avatar,
  CircularProgress, Alert, Tabs, Tab, TextField, Button,
  IconButton, Snackbar,
} from "@mui/material";
import LocationOnIcon from "@mui/icons-material/LocationOn";
import AccessTimeIcon from "@mui/icons-material/AccessTime";
import SportsIcon from "@mui/icons-material/Sports";
import EditIcon from "@mui/icons-material/Edit";
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
    email?: string;
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
  isOwnProfile: boolean;
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

function ProfileEditForm({ user, onSaved }: { user: UserProfile["user"]; onSaved: () => void }) {
  const t = useT();
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snackbar, setSnackbar] = useState(false);

  const handleSave = async () => {
    setError(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), email: email.trim() }),
      });
      if (!res.ok) {
        const json = await res.json();
        setError(json.error || t("profileUpdateError"));
      } else {
        setSnackbar(true);
        onSaved();
      }
    } catch {
      setError(t("profileUpdateError"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Paper elevation={2} sx={{ borderRadius: 3, p: { xs: 2, sm: 3 } }}>
      <Stack spacing={2}>
        <Typography variant="h6" fontWeight={600}>{t("editProfile")}</Typography>
        {error && <Alert severity="error">{error}</Alert>}
        <TextField
          label={t("name")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          fullWidth
          size="small"
          inputProps={{ maxLength: 50 }}
        />
        <TextField
          label={t("email")}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          fullWidth
          size="small"
        />
        <Stack direction="row" spacing={1}>
          <Button
            variant="contained"
            onClick={handleSave}
            disabled={saving || !name.trim() || !email.trim()}
          >
            {t("saveProfile")}
          </Button>
        </Stack>
      </Stack>
      <Snackbar
        open={snackbar}
        autoHideDuration={3000}
        onClose={() => setSnackbar(false)}
        message={t("profileUpdated")}
      />
    </Paper>
  );
}

export default function UserProfilePage({ userId }: { userId: string }) {
  const t = useT();
  const locale = detectLocale();
  const [tab, setTab] = React.useState(0);
  const [editing, setEditing] = useState(false);

  const { data, isLoading, error, mutate } = useSWR<UserProfile>(
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

  const { user, owned, joined, stats, isOwnProfile } = data;
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
                  <Stack direction="row" alignItems="center" spacing={1}>
                    <Typography variant="h5" fontWeight={700}>{user.name}</Typography>
                    {isOwnProfile && !editing && (
                      <IconButton size="small" onClick={() => setEditing(true)}>
                        <EditIcon fontSize="small" />
                      </IconButton>
                    )}
                  </Stack>
                  <Typography variant="body2" color="text.secondary">
                    {t("playerSince", { date: memberSince.toLocaleDateString(locale === "pt" ? "pt-PT" : "en-GB", { month: "long", year: "numeric" }) })}
                  </Typography>
                  {isOwnProfile && user.email && !editing && (
                    <Typography variant="body2" color="text.secondary">{user.email}</Typography>
                  )}
                </Box>
              </Stack>
              <Stack direction="row" spacing={2} sx={{ mt: 2, flexWrap: "wrap" }}>
                <Chip icon={<SportsIcon />} label={`${stats.totalGames} ${t("gamesPlayed").toLowerCase()}`} variant="outlined" />
                <Chip label={`${stats.ownedGames} ${t("ownedGames").toLowerCase()}`} variant="outlined" size="small" />
                <Chip label={`${stats.joinedGames} ${t("joinedGames").toLowerCase()}`} variant="outlined" size="small" />
              </Stack>
            </Paper>

            {/* Edit form */}
            {editing && isOwnProfile && (
              <ProfileEditForm
                user={user}
                onSaved={() => { setEditing(false); mutate(); }}
              />
            )}

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
