import React, { useState, useEffect, useCallback } from "react";
import {
  Container, Paper, Typography, Stack, Box, Chip, Avatar,
  CircularProgress, Alert, Tabs, Tab, TextField, Button,
  IconButton, Snackbar, Divider, Dialog, DialogTitle,
  DialogContent, DialogActions,
} from "@mui/material";
import SportsIcon from "@mui/icons-material/Sports";
import EditIcon from "@mui/icons-material/Edit";
import LockIcon from "@mui/icons-material/Lock";
import DownloadIcon from "@mui/icons-material/Download";
import DeleteForeverIcon from "@mui/icons-material/DeleteForever";
import { ThemeModeProvider } from "./ThemeModeProvider";
import { ResponsiveLayout } from "./ResponsiveLayout";
import { NotificationSettingsSection } from "./NotificationSettingsSection";
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
  hasPassword?: boolean;
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

/** Password change section */
function ChangePasswordSection({ hasPassword }: { hasPassword: boolean }) {
  const t = useT();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snackbar, setSnackbar] = useState(false);

  const handleChangePassword = async () => {
    setError(null);
    if (newPassword !== confirmPassword) {
      setError(t("passwordsDoNotMatch"));
      return;
    }
    if (newPassword.length < 8) {
      setError(t("passwordTooShortError"));
      return;
    }
    setSaving(true);
    try {
      const result = await authClient.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: false,
      });
      if (result.error) {
        setError(result.error.message || t("passwordChangeError"));
      } else {
        setSnackbar(true);
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
      }
    } catch {
      setError(t("passwordChangeError"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Paper elevation={2} sx={{ borderRadius: 3, p: { xs: 2, sm: 3 } }}>
      <Stack spacing={2}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <LockIcon fontSize="small" color="action" />
          <Typography variant="h6" fontWeight={600}>{t("accountSecurity")}</Typography>
        </Stack>
        {!hasPassword ? (
          <Alert severity="info">{t("noPasswordSet")}</Alert>
        ) : (
          <>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField
              label={t("currentPassword")}
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              fullWidth
              size="small"
              autoComplete="current-password"
            />
            <TextField
              label={t("newPassword")}
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              fullWidth
              size="small"
              autoComplete="new-password"
            />
            <TextField
              label={t("confirmNewPassword")}
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              fullWidth
              size="small"
              autoComplete="new-password"
            />
            <Stack direction="row" spacing={1}>
              <Button
                variant="contained"
                onClick={handleChangePassword}
                disabled={saving || !currentPassword || !newPassword || !confirmPassword}
              >
                {saving ? t("changingPassword") : t("changePasswordBtn")}
              </Button>
            </Stack>
          </>
        )}
      </Stack>
      <Snackbar
        open={snackbar}
        autoHideDuration={3000}
        onClose={() => setSnackbar(false)}
        message={t("passwordChanged")}
      />
    </Paper>
  );
}

/** Data export section */
function ExportDataSection() {
  const t = useT();
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snackbar, setSnackbar] = useState(false);

  const handleExport = async () => {
    setError(null);
    setExporting(true);
    try {
      const res = await fetch("/api/me/export");
      if (!res.ok) {
        setError(t("exportDataError"));
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `convocados-data-export.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setSnackbar(true);
    } catch {
      setError(t("exportDataError"));
    } finally {
      setExporting(false);
    }
  };

  return (
    <Paper elevation={2} sx={{ borderRadius: 3, p: { xs: 2, sm: 3 } }}>
      <Stack spacing={2}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <DownloadIcon fontSize="small" color="action" />
          <Typography variant="h6" fontWeight={600}>{t("exportData")}</Typography>
        </Stack>
        <Typography variant="body2" color="text.secondary">{t("exportDataDesc")}</Typography>
        {error && <Alert severity="error">{error}</Alert>}
        <Stack direction="row" spacing={1}>
          <Button
            variant="outlined"
            onClick={handleExport}
            disabled={exporting}
            startIcon={<DownloadIcon />}
          >
            {exporting ? t("exportingData") : t("exportDataBtn")}
          </Button>
        </Stack>
      </Stack>
      <Snackbar
        open={snackbar}
        autoHideDuration={3000}
        onClose={() => setSnackbar(false)}
        message={t("dataExported")}
      />
    </Paper>
  );
}

/** Account deletion section (danger zone) */
function DeleteAccountSection() {
  const t = useT();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [password, setPassword] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async () => {
    setError(null);
    if (confirmText !== "DELETE") return;
    setDeleting(true);
    try {
      const res = await fetch("/api/me/account", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const json = await res.json();
        setError(json.error || t("deleteAccountError"));
        setDeleting(false);
        return;
      }
      // Sign out and redirect to home
      await authClient.signOut();
      window.location.href = "/";
    } catch {
      setError(t("deleteAccountError"));
      setDeleting(false);
    }
  };

  return (
    <>
      <Paper
        elevation={2}
        sx={{ borderRadius: 3, p: { xs: 2, sm: 3 }, border: "1px solid", borderColor: "error.main" }}
      >
        <Stack spacing={2}>
          <Stack direction="row" alignItems="center" spacing={1}>
            <DeleteForeverIcon fontSize="small" color="error" />
            <Typography variant="h6" fontWeight={600} color="error.main">{t("dangerZone")}</Typography>
          </Stack>
          <Divider />
          <Typography variant="subtitle2" fontWeight={600}>{t("deleteAccount")}</Typography>
          <Typography variant="body2" color="text.secondary">{t("deleteAccountDesc")}</Typography>
          <Stack direction="row" spacing={1}>
            <Button
              variant="outlined"
              color="error"
              onClick={() => setDialogOpen(true)}
              startIcon={<DeleteForeverIcon />}
            >
              {t("deleteAccountBtn")}
            </Button>
          </Stack>
        </Stack>
      </Paper>

      <Dialog open={dialogOpen} onClose={() => !deleting && setDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle color="error.main">{t("deleteAccount")}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography variant="body2">{t("deleteAccountDesc")}</Typography>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField
              label={t("deleteAccountConfirm")}
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              fullWidth
              size="small"
              placeholder="DELETE"
              autoComplete="off"
            />
            <TextField
              label={t("password")}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              fullWidth
              size="small"
              autoComplete="current-password"
              helperText={t("deleteAccountPasswordRequired")}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)} disabled={deleting}>{t("cancel")}</Button>
          <Button
            variant="contained"
            color="error"
            onClick={handleDelete}
            disabled={deleting || confirmText !== "DELETE"}
          >
            {deleting ? t("deletingAccount") : t("deleteAccountBtn")}
          </Button>
        </DialogActions>
      </Dialog>
    </>
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

  const { user, owned, joined, stats, isOwnProfile, hasPassword } = data;
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

            {/* Account management sections (own profile only) */}
            {isOwnProfile && (
              <>
                <NotificationSettingsSection />
                <ChangePasswordSection hasPassword={hasPassword ?? false} />
                <ExportDataSection />
                <DeleteAccountSection />
              </>
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
