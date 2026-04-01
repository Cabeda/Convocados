import React, { useState, useEffect, useCallback } from "react";
import {
  Container, Paper, Typography, Stack, Box, Chip, Avatar,
  CircularProgress, Alert, Tabs, Tab, TextField, Button,
  IconButton, Snackbar, Divider, Dialog, DialogTitle,
  DialogContent, DialogActions, Switch, FormControlLabel,
  alpha, useTheme,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
} from "@mui/material";
import SportsIcon from "@mui/icons-material/Sports";
import EditIcon from "@mui/icons-material/Edit";
import LockIcon from "@mui/icons-material/Lock";
import DownloadIcon from "@mui/icons-material/Download";
import DeleteForeverIcon from "@mui/icons-material/DeleteForever";
import BarChartIcon from "@mui/icons-material/BarChart";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
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
  publicStats?: boolean;
  profileVisibility?: string;
  owned: GameSummary[];
  joined: GameSummary[];
  stats: {
    totalGames: number;
    ownedGames: number;
    joinedGames: number;
  };
  isOwnProfile: boolean;
}

// ── Stats types & components ────────────────────────────────────────────────

interface EventStats {
  eventId: string;
  eventTitle: string;
  sport: string;
  rating: number;
  gamesPlayed: number;
  wins: number;
  draws: number;
  losses: number;
  winRate: number;
  attendance: {
    gamesPlayed: number;
    totalGames: number;
    attendanceRate: number;
    currentStreak: number;
  } | null;
}

interface StatsData {
  summary: {
    totalGames: number;
    totalWins: number;
    totalDraws: number;
    totalLosses: number;
    winRate: number;
    avgRating: number;
    bestRating: number;
    eventsPlayed: number;
  };
  events: EventStats[];
}

function StatCard({ label, value, color }: { label: string; value: string | number; color?: string }) {
  const theme = useTheme();
  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2, borderRadius: 2, textAlign: "center", flex: "1 1 120px", minWidth: 100,
        bgcolor: color ? alpha(color, theme.palette.mode === "dark" ? 0.1 : 0.04) : undefined,
      }}
    >
      <Typography variant="h5" fontWeight={700} color={color ?? "text.primary"}>
        {value}
      </Typography>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
    </Paper>
  );
}

function RatingBar({ rating, maxRating }: { rating: number; maxRating: number }) {
  const theme = useTheme();
  const pct = maxRating > 0 ? Math.min((rating / maxRating) * 100, 100) : 0;
  const color = rating >= 1200
    ? theme.palette.success.main
    : rating >= 1000
      ? theme.palette.primary.main
      : theme.palette.warning.main;

  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, width: "100%" }}>
      <Box sx={{ flex: 1, height: 8, borderRadius: 4, bgcolor: alpha(color, 0.15) }}>
        <Box sx={{ width: `${pct}%`, height: "100%", borderRadius: 4, bgcolor: color, transition: "width 0.3s" }} />
      </Box>
      <Typography variant="body2" fontWeight={700} sx={{ minWidth: 40, textAlign: "right" }}>
        {rating}
      </Typography>
    </Box>
  );
}

function StatsTabContent({ userId }: { userId: string }) {
  const t = useT();
  const theme = useTheme();
  const [data, setData] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch(`/api/users/${userId}/stats`)
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => { setError(true); setLoading(false); });
  }, [userId]);

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return <Alert severity="error">{t("somethingWentWrong")}</Alert>;
  }

  if (!data || data.summary.totalGames === 0) {
    return (
      <Box sx={{ textAlign: "center", py: 4 }}>
        <SportsIcon sx={{ fontSize: 48, color: "text.disabled", mb: 1 }} />
        <Typography variant="h6" color="text.secondary">{t("statsNoData")}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>{t("statsNoDataDesc")}</Typography>
      </Box>
    );
  }

  return (
    <Stack spacing={2}>
      {/* Summary cards */}
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1.5 }}>
        <StatCard label={t("statsTotalGames")} value={data.summary.totalGames} />
        <StatCard label={t("statsWins")} value={data.summary.totalWins} color={theme.palette.success.main} />
        <StatCard label={t("statsDraws")} value={data.summary.totalDraws} />
        <StatCard label={t("statsLosses")} value={data.summary.totalLosses} color={theme.palette.error.main} />
        <StatCard label={t("statsWinRate")} value={`${Math.round(data.summary.winRate * 100)}%`} color={theme.palette.primary.main} />
        <StatCard label={t("statsAvgRating")} value={data.summary.avgRating} />
        <StatCard label={t("statsBestRating")} value={data.summary.bestRating} color={theme.palette.success.main} />
        <StatCard label={t("statsEventsPlayed")} value={data.summary.eventsPlayed} />
      </Box>

      {/* W/D/L ratio bar */}
      <Box>
        <Box sx={{ display: "flex", height: 12, borderRadius: 6, overflow: "hidden" }}>
          {data.summary.totalWins > 0 && (
            <Box sx={{ flex: data.summary.totalWins, bgcolor: "success.main", transition: "flex 0.3s" }} />
          )}
          {data.summary.totalDraws > 0 && (
            <Box sx={{ flex: data.summary.totalDraws, bgcolor: "grey.400", transition: "flex 0.3s" }} />
          )}
          {data.summary.totalLosses > 0 && (
            <Box sx={{ flex: data.summary.totalLosses, bgcolor: "error.main", transition: "flex 0.3s" }} />
          )}
        </Box>
        <Stack direction="row" spacing={2} sx={{ mt: 1, justifyContent: "center" }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
            <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: "success.main" }} />
            <Typography variant="caption">{t("statsWins")} ({data.summary.totalWins})</Typography>
          </Box>
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
            <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: "grey.400" }} />
            <Typography variant="caption">{t("statsDraws")} ({data.summary.totalDraws})</Typography>
          </Box>
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
            <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: "error.main" }} />
            <Typography variant="caption">{t("statsLosses")} ({data.summary.totalLosses})</Typography>
          </Box>
        </Stack>
      </Box>

      {/* Per-event breakdown */}
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow sx={{ bgcolor: alpha(theme.palette.primary.main, theme.palette.mode === "dark" ? 0.15 : 0.06) }}>
              <TableCell sx={{ fontWeight: 700 }}></TableCell>
              <TableCell align="center" sx={{ fontWeight: 700 }}>{t("rating")}</TableCell>
              <TableCell align="center" sx={{ fontWeight: 700 }}>{t("gamesPlayed")}</TableCell>
              <TableCell align="center" sx={{ fontWeight: 700, color: "success.main" }}>{t("wins")}</TableCell>
              <TableCell align="center" sx={{ fontWeight: 700 }}>{t("draws")}</TableCell>
              <TableCell align="center" sx={{ fontWeight: 700, color: "error.main" }}>{t("losses")}</TableCell>
              <TableCell align="center" sx={{ fontWeight: 700 }}>{t("statsAttendanceRate")}</TableCell>
              <TableCell sx={{ width: 48 }} />
            </TableRow>
          </TableHead>
          <TableBody>
            {data.events.map((ev) => (
              <TableRow key={ev.eventId} sx={{ "&:last-child td": { borderBottom: 0 } }}>
                <TableCell>
                  <Stack spacing={0.5}>
                    <Typography variant="body2" fontWeight={600}>{ev.eventTitle}</Typography>
                    <RatingBar rating={ev.rating} maxRating={data.summary.bestRating > 0 ? data.summary.bestRating * 1.1 : 1500} />
                  </Stack>
                </TableCell>
                <TableCell align="center">
                  <Chip
                    label={ev.rating}
                    size="small"
                    sx={{
                      fontWeight: 700, fontSize: "0.8rem", minWidth: 48,
                      bgcolor: alpha(theme.palette.primary.main, 0.1),
                      color: theme.palette.text.primary,
                    }}
                  />
                </TableCell>
                <TableCell align="center">
                  <Typography variant="body2">{ev.gamesPlayed}</Typography>
                </TableCell>
                <TableCell align="center">
                  <Typography variant="body2" color="success.main" fontWeight={600}>{ev.wins}</Typography>
                </TableCell>
                <TableCell align="center">
                  <Typography variant="body2" color="text.secondary">{ev.draws}</Typography>
                </TableCell>
                <TableCell align="center">
                  <Typography variant="body2" color="error.main" fontWeight={600}>{ev.losses}</Typography>
                </TableCell>
                <TableCell align="center">
                  {ev.attendance ? (
                    <Stack spacing={0.5} alignItems="center">
                      <Typography variant="body2">
                        {Math.round(ev.attendance.attendanceRate * 100)}%
                      </Typography>
                      {ev.attendance.currentStreak > 0 && (
                        <Chip
                          label={`${ev.attendance.currentStreak} ${t("statsCurrentStreak").toLowerCase()}`}
                          size="small"
                          variant="outlined"
                          sx={{ fontSize: "0.65rem" }}
                        />
                      )}
                    </Stack>
                  ) : (
                    <Typography variant="body2" color="text.secondary">—</Typography>
                  )}
                </TableCell>
                <TableCell>
                  <Button
                    href={`/events/${ev.eventId}`}
                    size="small"
                    sx={{ minWidth: 0, p: 0.5 }}
                    aria-label={t("statsViewEvent")}
                  >
                    <OpenInNewIcon fontSize="small" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Stack>
  );
}

// ── Profile form & settings components ──────────────────────────────────────

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

/** Profile visibility selector (public / participants / private) */
function ProfileVisibilitySection({ userId, userName, initialValue }: { userId: string; userName: string; initialValue: string }) {
  const t = useT();
  const [visibility, setVisibility] = useState(initialValue);
  const [saving, setSaving] = useState(false);
  const [snackbar, setSnackbar] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleChange = async (value: string) => {
    setError(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: userName, profileVisibility: value }),
      });
      if (!res.ok) {
        setError(t("publicStatsSaveError"));
        setSaving(false);
        return;
      }
      setVisibility(value);
      setSnackbar(true);
    } catch {
      setError(t("publicStatsSaveError"));
    } finally {
      setSaving(false);
    }
  };

  const options: { value: string; label: string; desc: string }[] = [
    { value: "public", label: t("visibilityPublic"), desc: t("visibilityPublicDesc") },
    { value: "participants", label: t("visibilityParticipants"), desc: t("visibilityParticipantsDesc") },
    { value: "private", label: t("visibilityPrivate"), desc: t("visibilityPrivateDesc") },
  ];

  return (
    <Paper elevation={2} sx={{ borderRadius: 3, p: { xs: 2, sm: 3 } }}>
      <Stack spacing={2}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <BarChartIcon fontSize="small" color="action" />
          <Typography variant="h6" fontWeight={600}>{t("profileVisibilityLabel")}</Typography>
        </Stack>
        <Typography variant="body2" color="text.secondary">{t("profileVisibilityDesc")}</Typography>
        {error && <Alert severity="error">{error}</Alert>}
        <Stack spacing={1}>
          {options.map((opt) => {
            const selected = visibility === opt.value;
            return (
              <Box
                key={opt.value}
                onClick={() => !saving && handleChange(opt.value)}
                sx={{
                  p: 2, borderRadius: 2, cursor: saving ? "default" : "pointer",
                  border: "2px solid",
                  borderColor: selected ? "primary.main" : "divider",
                  backgroundColor: selected ? "primary.50" : "background.paper",
                  transition: "all 0.15s",
                  "&:hover": saving ? {} : { borderColor: "primary.light", backgroundColor: "action.hover" },
                }}
              >
                <Stack direction="row" alignItems="center" justifyContent="space-between">
                  <Box>
                    <Typography variant="body2" fontWeight={selected ? 700 : 500}>{opt.label}</Typography>
                    <Typography variant="caption" color="text.secondary">{opt.desc}</Typography>
                  </Box>
                  {selected && <Box sx={{ width: 12, height: 12, borderRadius: "50%", backgroundColor: "primary.main" }} />}
                </Stack>
              </Box>
            );
          })}
        </Stack>
      </Stack>
      <Snackbar
        open={snackbar}
        autoHideDuration={3000}
        onClose={() => setSnackbar(false)}
        message={t("publicStatsSaved")}
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
  const showStats = isOwnProfile || data.profileVisibility === "public" || (data.profileVisibility === "participants" && !isOwnProfile) || data.publicStats;
  const memberSince = new Date(user.createdAt);

  // Tab indices shift when stats tab is present
  const STATS_TAB = showStats ? 0 : -1;
  const HISTORY_TAB = showStats ? 1 : 0;
  const OWNED_TAB = showStats ? 2 : 1;
  const JOINED_TAB = showStats ? 3 : 2;

  const allGames = tab === HISTORY_TAB
    ? [...owned, ...joined].sort((a, b) => new Date(b.dateTime).getTime() - new Date(a.dateTime).getTime())
    : tab === OWNED_TAB ? owned : joined;

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
                <ProfileVisibilitySection userId={user.id} userName={user.name} initialValue={data.profileVisibility ?? "public"} />
                <NotificationSettingsSection />
                <ChangePasswordSection hasPassword={hasPassword ?? false} />
                <ExportDataSection />
                <DeleteAccountSection />
              </>
            )}

            {/* Tabs: Stats (if visible) + History + Owned + Joined */}
            <Paper elevation={2} sx={{ borderRadius: 3, overflow: "hidden" }}>
              <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="fullWidth">
                {showStats && <Tab label={t("playerStats")} />}
                <Tab label={`${t("history")} (${stats.totalGames})`} />
                <Tab label={`${t("ownedGames")} (${stats.ownedGames})`} />
                <Tab label={`${t("joinedGames")} (${stats.joinedGames})`} />
              </Tabs>
              <Box sx={{ p: { xs: 2, sm: 3 } }}>
                {tab === STATS_TAB && showStats ? (
                  <StatsTabContent userId={userId} />
                ) : (
                  allGames.length > 0 ? (
                    <Stack spacing={1.5}>
                      {allGames.map((g) => <GameCard key={g.id} game={g} dimPast />)}
                    </Stack>
                  ) : (
                    <Alert severity="info">
                      {tab === OWNED_TAB ? t("noOwnedGames") : tab === JOINED_TAB ? t("noJoinedGames") : t("noHistory")}
                    </Alert>
                  )
                )}
              </Box>
            </Paper>
          </Stack>
        </Container>
      </ResponsiveLayout>
    </ThemeModeProvider>
  );
}
