import React, { useState, useEffect, useCallback } from "react";
import {
  Container, Paper, Typography, Stack, Box, Chip, Avatar,
  CircularProgress, Alert, Tabs, Tab, TextField, Button,
  IconButton, Snackbar,
} from "@mui/material";
import SportsIcon from "@mui/icons-material/Sports";
import EditIcon from "@mui/icons-material/Edit";
import { ThemeModeProvider } from "./ThemeModeProvider";
import { ResponsiveLayout } from "./ResponsiveLayout";
import { useT } from "~/lib/useT";
import { detectLocale } from "~/lib/i18n";
import { GameCard, type GameSummary } from "./GameCard";
import { authClient } from "~/lib/auth.client";

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

function ProfileEditForm({ user, onSaved }: { user: UserProfile["user"]; onSaved: () => void }) {
  const t = useT();
  const [name, setName] = useState(user.name);
  const [newEmail, setNewEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [changingEmail, setChangingEmail] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snackbar, setSnackbar] = useState(false);
  const [emailSnackbar, setEmailSnackbar] = useState(false);

  const handleSave = async () => {
    setError(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
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

  const handleChangeEmail = async () => {
    if (!newEmail.trim()) return;
    setError(null);
    setChangingEmail(true);
    try {
      const result = await authClient.changeEmail({ newEmail: newEmail.trim() });
      if (result.error) {
        setError(result.error.message || t("profileUpdateError"));
      } else {
        setEmailSnackbar(true);
        setNewEmail("");
      }
    } catch {
      setError(t("profileUpdateError"));
    } finally {
      setChangingEmail(false);
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
        <Stack direction="row" spacing={1}>
          <Button
            variant="contained"
            onClick={handleSave}
            disabled={saving || !name.trim()}
          >
            {t("saveProfile")}
          </Button>
        </Stack>

        <Typography variant="subtitle2" fontWeight={600} sx={{ mt: 2 }}>{t("changeEmail")}</Typography>
        <Typography variant="body2" color="text.secondary">{user.email}</Typography>
        <TextField
          label={t("newEmail")}
          type="email"
          value={newEmail}
          onChange={(e) => setNewEmail(e.target.value)}
          fullWidth
          size="small"
          autoComplete="email"
        />
        <Stack direction="row" spacing={1}>
          <Button
            variant="outlined"
            onClick={handleChangeEmail}
            disabled={changingEmail || !newEmail.trim()}
          >
            {changingEmail ? t("resendingVerification") : t("changeEmailBtn")}
          </Button>
        </Stack>
      </Stack>
      <Snackbar
        open={snackbar}
        autoHideDuration={3000}
        onClose={() => setSnackbar(false)}
        message={t("profileUpdated")}
      />
      <Snackbar
        open={emailSnackbar}
        autoHideDuration={5000}
        onClose={() => setEmailSnackbar(false)}
        message={t("changeEmailSent")}
      />
    </Paper>
  );
}

export default function UserProfilePage({ userId }: { userId: string }) {
  const t = useT();
  const locale = detectLocale();
  const [tab, setTab] = React.useState(0);
  const [editing, setEditing] = useState(false);

  const [data, setData] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchProfile = useCallback(async () => {
    try {
      const r = await fetch(`/api/users/${userId}`);
      if (!r.ok) throw new Error("Not found");
      const json = await r.json();
      setData(json);
      setError(null);
    } catch (e) {
      setError(e as Error);
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  useEffect(() => { fetchProfile(); }, [fetchProfile]);

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
                onSaved={() => { setEditing(false); fetchProfile(); }}
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
                    {allGames.map((g) => <GameCard key={g.id} game={g} dimPast />)}
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
