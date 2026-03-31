import React, { useState, useEffect, useCallback } from "react";
import {
  Box, Typography, Stack, Switch, FormControlLabel, Slider, Button, Chip,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Paper, Alert, CircularProgress, IconButton, Tooltip, Divider,
  FormControl, Select, MenuItem, Card, CardContent, CardHeader,
  TextField, List, ListItem, ListItemText, ListItemSecondaryAction,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import PublicIcon from "@mui/icons-material/Public";
import StarIcon from "@mui/icons-material/Star";
import PersonRemoveIcon from "@mui/icons-material/PersonRemove";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CancelIcon from "@mui/icons-material/Cancel";
import HourglassEmptyIcon from "@mui/icons-material/HourglassEmpty";
import IntegrationInstructionsIcon from "@mui/icons-material/IntegrationInstructions";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import LogoutIcon from "@mui/icons-material/Logout";
import LockIcon from "@mui/icons-material/Lock";
import PersonAddIcon from "@mui/icons-material/PersonAdd";
import DeleteIcon from "@mui/icons-material/Delete";
import GroupIcon from "@mui/icons-material/Group";
import ArchiveIcon from "@mui/icons-material/Archive";
import UnarchiveIcon from "@mui/icons-material/Unarchive";
import { useT } from "~/lib/useT";
import { SPORT_PRESETS } from "~/lib/sports";
import { useSession } from "~/lib/auth.client";
import { ThemeModeProvider } from "./ThemeModeProvider";
import { ResponsiveLayout } from "./ResponsiveLayout";

// ── Types ─────────────────────────────────────────────────────────────────────

interface PrioritySettings {
  priorityEnabled: boolean;
  priorityThreshold: number;
  priorityWindow: number;
  priorityMaxPercent: number;
  priorityDeadlineHours: number;
  priorityMinGames: number;
}

interface Enrollment {
  userId: string;
  name: string;
  source: string;
  optedIn: boolean;
  declineStreak: number;
  noShowStreak: number;
}

interface EligiblePlayer {
  userId: string;
  name: string;
  attendanceRate: number;
  gamesInWindow: number;
  currentStreak: number;
}

interface PriorityData {
  settings: PrioritySettings;
  enrollments: Enrollment[];
  eligible: EligiblePlayer[];
  ineligible: { userId: string; name: string; reason: string }[];
  maxSlots: number;
}

interface Props {
  eventId: string;
}

// ── Section Card ──────────────────────────────────────────────────────────────

function SectionCard({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card variant="outlined" sx={{ borderRadius: 3 }}>
      <CardHeader
        avatar={icon}
        title={<Typography variant="subtitle1" fontWeight={600}>{title}</Typography>}
        sx={{ pb: 0, "& .MuiCardHeader-avatar": { minWidth: 0, mr: 1.5 } }}
      />
      <CardContent>
        {children}
      </CardContent>
    </Card>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function EventSettingsPage({ eventId }: Props) {
  const t = useT();
  const { data: session } = useSession();

  // Event data
  const [event, setEvent] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Priority data
  const [priorityData, setPriorityData] = useState<PriorityData | null>(null);
  const [localPriority, setLocalPriority] = useState<PrioritySettings | null>(null);
  const [savingPriority, setSavingPriority] = useState(false);

  // Webhook copy
  const [webhookCopied, setWebhookCopied] = useState(false);

  // Access control
  const [hasPassword, setHasPassword] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [invites, setInvites] = useState<{ id: string; userId: string; name: string; email: string }[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteError, setInviteError] = useState<string | null>(null);

  // Event admins
  const [admins, setAdmins] = useState<{ id: string; userId: string; name: string; email: string }[]>([]);
  const [adminEmail, setAdminEmail] = useState("");
  const [adminError, setAdminError] = useState<string | null>(null);

  const fetchEvent = useCallback(async () => {
    try {
      const res = await fetch(`/api/events/${eventId}`);
      if (res.ok) setEvent(await res.json());
    } catch { /* ignore */ }
    setLoading(false);
  }, [eventId]);

  const fetchPriority = useCallback(async () => {
    try {
      const res = await fetch(`/api/events/${eventId}/priority`);
      if (res.ok) {
        const json = await res.json();
        setPriorityData(json);
        setLocalPriority(json.settings);
      }
    } catch { /* ignore */ }
  }, [eventId]);

  const fetchAccessInfo = useCallback(async () => {
    try {
      const [accessRes, invitesRes, adminsRes] = await Promise.all([
        fetch(`/api/events/${eventId}/access`),
        fetch(`/api/events/${eventId}/access/invites`),
        fetch(`/api/events/${eventId}/admins`),
      ]);
      if (accessRes.ok) {
        const data = await accessRes.json();
        setHasPassword(data.hasPassword);
      }
      if (invitesRes.ok) {
        setInvites(await invitesRes.json());
      }
      if (adminsRes.ok) {
        setAdmins(await adminsRes.json());
      }
    } catch { /* ignore */ }
  }, [eventId]);

  useEffect(() => {
    fetchEvent();
    fetchPriority();
    fetchAccessInfo();
  }, [fetchEvent, fetchPriority, fetchAccessInfo]);

  // Derived state
  const isAuthenticated = !!session?.user;
  const isOwner = !!(session?.user && event?.ownerId && session.user.id === event.ownerId);
  const isAdmin = !!event?.isAdmin;
  const isOwnerless = event && !event.ownerId;
  const canEdit = isOwnerless || isOwner || isAdmin;
  const userId = session?.user?.id;

  // ── Handlers ──────────────────────────────────────────────────────────────

  const updateSetting = async (endpoint: string, body: Record<string, unknown>) => {
    setMessage(null);
    const res = await fetch(`/api/events/${eventId}/${endpoint}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      await fetchEvent();
      setMessage({ type: "success", text: t("prioritySettingsSaved") });
    } else {
      setMessage({ type: "error", text: t("prioritySettingsError") });
    }
  };

  const handleTogglePublic = (v: boolean) => {
    setEvent((e: any) => e ? { ...e, isPublic: v } : e);
    updateSetting("visibility", { isPublic: v });
  };

  const handleToggleBalanced = (v: boolean) => {
    setEvent((e: any) => e ? { ...e, balanced: v } : e);
    updateSetting("balanced", { balanced: v });
  };

  const handleToggleElo = (v: boolean) => {
    setEvent((e: any) => e ? { ...e, eloEnabled: v, ...(v ? {} : { balanced: false }) } : e);
    updateSetting("elo", { eloEnabled: v });
  };

  const handleToggleManualRating = (v: boolean) => {
    setEvent((e: any) => e ? { ...e, allowManualRating: v } : e);
    updateSetting("manual-rating", { allowManualRating: v });
  };

  const handleToggleSplitCosts = (v: boolean) => {
    setEvent((e: any) => e ? { ...e, splitCostsEnabled: v } : e);
    updateSetting("split-costs", { splitCostsEnabled: v });
  };

  const handleSportChange = (v: string) => {
    setEvent((e: any) => e ? { ...e, sport: v } : e);
    updateSetting("sport", { sport: v });
  };

  const handleRelinquish = async () => {
    const res = await fetch(`/api/events/${eventId}/claim`, { method: "DELETE" });
    if (res.ok) await fetchEvent();
  };

  // Priority handlers
  const savePrioritySetting = async (updates: Partial<PrioritySettings>) => {
    setSavingPriority(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/events/${eventId}/priority`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (res.ok) {
        setMessage({ type: "success", text: t("prioritySettingsSaved") });
        await fetchPriority();
      } else {
        setMessage({ type: "error", text: t("prioritySettingsError") });
      }
    } catch {
      setMessage({ type: "error", text: t("prioritySettingsError") });
    }
    setSavingPriority(false);
  };

  const handleTogglePriority = async (enabled: boolean) => {
    setLocalPriority((s) => s ? { ...s, priorityEnabled: enabled } : s);
    await savePrioritySetting({ priorityEnabled: enabled });
  };

  const handleRemovePlayer = async (targetUserId: string) => {
    await fetch(`/api/events/${eventId}/priority/${targetUserId}`, { method: "DELETE" });
    await fetchPriority();
  };

  const handleConfirm = async () => {
    const res = await fetch(`/api/events/${eventId}/priority/confirm`, { method: "POST" });
    if (res.ok) {
      setMessage({ type: "success", text: t("priorityConfirmed") });
      await fetchPriority();
    }
  };

  const handleDecline = async () => {
    const res = await fetch(`/api/events/${eventId}/priority/decline`, { method: "POST" });
    if (res.ok) {
      setMessage({ type: "success", text: t("priorityDeclinedMsg") });
      await fetchPriority();
    }
  };

  const handleOptOut = async () => {
    const res = await fetch(`/api/events/${eventId}/priority/opt-out`, {
      method: "PUT", headers: { "content-type": "application/json" }, body: "{}",
    });
    if (res.ok) {
      setMessage({ type: "success", text: t("priorityOptedOutMsg") });
      await fetchPriority();
    }
  };

  const handleOptIn = async () => {
    const res = await fetch(`/api/events/${eventId}/priority/opt-in`, {
      method: "PUT", headers: { "content-type": "application/json" }, body: "{}",
    });
    if (res.ok) {
      setMessage({ type: "success", text: t("priorityOptedInMsg") });
      await fetchPriority();
    }
  };

  const handleCopyWebhook = async () => {
    const url = `${window.location.origin}/api/events/${eventId}/webhooks`;
    await navigator.clipboard.writeText(url);
    setWebhookCopied(true);
    setTimeout(() => setWebhookCopied(false), 2500);
  };

  // ── Access control handlers ───────────────────────────────────────────────

  const handleSetPassword = async () => {
    if (newPassword.length < 4) {
      setMessage({ type: "error", text: t("passwordMinLength") });
      return;
    }
    const res = await fetch(`/api/events/${eventId}/access`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: newPassword }),
    });
    if (res.ok) {
      setHasPassword(true);
      setNewPassword("");
      setMessage({ type: "success", text: t("passwordSet") });
    } else {
      setMessage({ type: "error", text: t("prioritySettingsError") });
    }
  };

  const handleRemovePassword = async () => {
    const res = await fetch(`/api/events/${eventId}/access`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: null }),
    });
    if (res.ok) {
      setHasPassword(false);
      setMessage({ type: "success", text: t("passwordRemoved") });
    }
  };

  const handleAddInvite = async () => {
    setInviteError(null);
    if (!inviteEmail.trim()) return;
    const res = await fetch(`/api/events/${eventId}/access/invites`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: inviteEmail.trim() }),
    });
    if (res.ok) {
      const invite = await res.json();
      setInvites((prev) => [...prev, invite]);
      setInviteEmail("");
      setMessage({ type: "success", text: t("inviteAdded") });
    } else {
      const data = await res.json();
      if (res.status === 404) setInviteError(t("userNotFound"));
      else if (res.status === 400) setInviteError(t("cannotInviteOwner"));
      else setInviteError(data.error || t("prioritySettingsError"));
    }
  };

  const handleRemoveInvite = async (userId: string) => {
    const res = await fetch(`/api/events/${eventId}/access/invites`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    if (res.ok) {
      setInvites((prev) => prev.filter((i) => i.userId !== userId));
      setMessage({ type: "success", text: t("inviteRemoved") });
    }
  };

  // ── Admin handlers ────────────────────────────────────────────────────

  const handleAddAdmin = async () => {
    setAdminError(null);
    if (!adminEmail.trim()) return;
    const res = await fetch(`/api/events/${eventId}/admins`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: adminEmail.trim() }),
    });
    if (res.ok) {
      const admin = await res.json();
      setAdmins((prev) => [...prev, admin]);
      setAdminEmail("");
      setMessage({ type: "success", text: t("adminAdded") });
    } else {
      const data = await res.json();
      if (res.status === 404) setAdminError(t("userNotFound"));
      else if (res.status === 400) setAdminError(t("cannotAddOwnerAsAdmin"));
      else setAdminError(data.error || t("prioritySettingsError"));
    }
  };

  const handleRemoveAdmin = async (userId: string) => {
    const res = await fetch(`/api/events/${eventId}/admins`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    if (res.ok) {
      setAdmins((prev) => prev.filter((a) => a.userId !== userId));
      setMessage({ type: "success", text: t("adminRemoved") });
    }
  };

  // ── Archive handler ───────────────────────────────────────────────────

  const handleArchiveToggle = async () => {
    const archive = !event.archivedAt;
    const res = await fetch(`/api/events/${eventId}/archive`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archive }),
    });
    if (res.ok) {
      await fetchEvent();
      setMessage({ type: "success", text: archive ? t("eventArchived") : t("eventUnarchived") });
    } else {
      setMessage({ type: "error", text: t("somethingWentWrong") });
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!event) return null;

  // Only the owner or admins can access settings; ownerless events are open to everyone
  if (event.ownerId && (!session?.user || (session.user.id !== event.ownerId && !event.isAdmin))) {
    return (
      <ThemeModeProvider>
        <ResponsiveLayout>
          <Stack spacing={2} sx={{ maxWidth: 640, mx: "auto", p: 2, alignItems: "center", pt: 8 }}>
            <Alert severity="warning">{t("settingsOwnerOnly")}</Alert>
            <Button href={`/events/${eventId}`} variant="outlined" size="small" startIcon={<ArrowBackIcon />}>
              {t("backToGame")}
            </Button>
          </Stack>
        </ResponsiveLayout>
      </ThemeModeProvider>
    );
  }

  const myEnrollment = priorityData?.enrollments.find((e) => e.userId === userId);

  return (
    <ThemeModeProvider>
      <ResponsiveLayout>
        <Stack spacing={3} sx={{ maxWidth: 640, mx: "auto", p: 2 }}>
      {/* Header */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <IconButton href={`/events/${eventId}`} size="small" aria-label={t("backToGame")}>
          <ArrowBackIcon />
        </IconButton>
        <Stack spacing={0}>
          <Typography variant="h5" fontWeight={700}>{t("eventSettings")}</Typography>
          <Typography variant="body2" color="text.secondary">{event.title}</Typography>
        </Stack>
      </Box>

      {message && (
        <Alert severity={message.type} onClose={() => setMessage(null)} sx={{ borderRadius: 2 }}>
          {message.text}
        </Alert>
      )}

      {/* ── General Settings ── */}
      <SectionCard title={t("eventSettingsGeneral")} icon={<PublicIcon color="action" />}>
        <Stack spacing={2}>
          <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap", alignItems: "center" }}>
            <Tooltip title={t("makePublicTooltip")}>
              <FormControlLabel
                control={<Switch size="small" checked={event.isPublic} onChange={(e) => handleTogglePublic(e.target.checked)} disabled={!canEdit} />}
                label={<Typography variant="body2">{t("makePublic")}</Typography>}
              />
            </Tooltip>
            <Tooltip title={t("eloEnabledTooltip")}>
              <FormControlLabel
                control={<Switch size="small" checked={event.eloEnabled ?? true} onChange={(e) => handleToggleElo(e.target.checked)} disabled={!canEdit} />}
                label={<Typography variant="body2">{t("eloEnabled")}</Typography>}
              />
            </Tooltip>
            <Tooltip title={t("balancedTeamsTooltip")}>
              <FormControlLabel
                control={<Switch size="small" checked={event.balanced} onChange={(e) => handleToggleBalanced(e.target.checked)} disabled={!canEdit || !(event.eloEnabled ?? true)} />}
                label={<Typography variant="body2" color={!(event.eloEnabled ?? true) ? "text.disabled" : undefined}>{t("balancedTeams")}</Typography>}
              />
            </Tooltip>
            <Tooltip title={t("splitCostsEnabledTooltip")}>
              <FormControlLabel
                control={<Switch size="small" checked={event.splitCostsEnabled ?? true} onChange={(e) => handleToggleSplitCosts(e.target.checked)} disabled={!canEdit} />}
                label={<Typography variant="body2">{t("splitCostsEnabled")}</Typography>}
              />
            </Tooltip>
            <Tooltip title={t("allowManualRatingTooltip")}>
              <FormControlLabel
                control={<Switch size="small" checked={event.allowManualRating ?? false} onChange={(e) => handleToggleManualRating(e.target.checked)} disabled={!canEdit || !(event.eloEnabled ?? true)} />}
                label={<Typography variant="body2" color={!(event.eloEnabled ?? true) ? "text.disabled" : undefined}>{t("allowManualRating")}</Typography>}
              />
            </Tooltip>
          </Box>
          <Box>
            <Typography variant="body2" color="text.secondary" gutterBottom>{t("sport")}</Typography>
            <FormControl size="small" sx={{ minWidth: 180 }} disabled={!canEdit}>
              <Select value={event.sport} onChange={(e) => handleSportChange(e.target.value)} sx={{ fontSize: "0.85rem" }}>
                {SPORT_PRESETS.map((s) => (
                  <MenuItem key={s.id} value={s.id} sx={{ fontSize: "0.85rem" }}>
                    {t(s.labelKey as any)}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>

        </Stack>
      </SectionCard>

      {/* ── Priority Enrollment ── */}
      {event.isRecurring && (
        <SectionCard title={t("priorityEnrollment")} icon={<StarIcon color="action" />}>
          <Stack spacing={2}>
            <Typography variant="body2" color="text.secondary">
              {t("priorityEnrollmentDesc")}
            </Typography>

            {canEdit && (
              <FormControlLabel
                control={<Switch checked={localPriority?.priorityEnabled ?? false} onChange={(e) => handleTogglePriority(e.target.checked)} disabled={savingPriority} />}
                label={<Typography variant="body2" fontWeight={500}>{t("priorityEnabled")}</Typography>}
              />
            )}

            {/* Player status */}
            {isAuthenticated && userId && localPriority?.priorityEnabled && (
              <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                {myEnrollment ? (
                  <Stack spacing={1}>
                    {myEnrollment.optedIn ? (
                      <>
                        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                          <StarIcon color="success" fontSize="small" />
                          <Typography variant="body2">{t("priorityYouQualify")}</Typography>
                        </Box>
                        <Box sx={{ display: "flex", gap: 1 }}>
                          <Button size="small" variant="contained" color="success" startIcon={<CheckCircleIcon />} onClick={handleConfirm}>
                            {t("priorityConfirmSpot")}
                          </Button>
                          <Button size="small" variant="outlined" color="error" startIcon={<CancelIcon />} onClick={handleDecline}>
                            {t("priorityDeclineSpot")}
                          </Button>
                        </Box>
                        <Button size="small" variant="text" color="inherit" onClick={handleOptOut} sx={{ alignSelf: "flex-start" }}>
                          {t("priorityOptOut")}
                        </Button>
                      </>
                    ) : (
                      <>
                        <Typography variant="body2" color="text.secondary">{t("priorityYouOptedOut")}</Typography>
                        <Button size="small" variant="outlined" onClick={handleOptIn} sx={{ alignSelf: "flex-start", mt: 1 }}>
                          {t("priorityOptIn")}
                        </Button>
                      </>
                    )}
                    {myEnrollment.declineStreak >= 3 && (
                      <Alert severity="warning" sx={{ py: 0 }}>
                        {t("priorityDeclineStreak").replace("{n}", String(myEnrollment.declineStreak))}
                      </Alert>
                    )}
                    {myEnrollment.noShowStreak >= 2 && (
                      <Alert severity="error" sx={{ py: 0 }}>
                        {t("priorityNoShowStreak").replace("{n}", String(myEnrollment.noShowStreak))}
                      </Alert>
                    )}
                  </Stack>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    {t("priorityYouNeedMore").replace("{n}", String(localPriority?.priorityMinGames ?? 3))}
                  </Typography>
                )}
              </Paper>
            )}

            {/* Owner: sliders */}
            {canEdit && localPriority?.priorityEnabled && (
              <Stack spacing={2} sx={{ mt: 1 }}>
                {([
                  { key: "priorityThreshold" as const, min: 1, max: 20, step: 1, label: t("priorityThreshold"), helper: t("priorityThresholdHelper"), suffix: "" },
                  { key: "priorityWindow" as const, min: 1, max: 20, step: 1, label: t("priorityWindow"), helper: t("priorityWindowHelper"), suffix: "" },
                  { key: "priorityMaxPercent" as const, min: 10, max: 100, step: 5, label: t("priorityMaxPercent"), helper: t("priorityMaxPercentHelper"), suffix: "%" },
                  { key: "priorityDeadlineHours" as const, min: 0, max: 168, step: 1, label: t("priorityDeadlineHours"), helper: t("priorityDeadlineHoursHelper"), suffix: "h" },
                  { key: "priorityMinGames" as const, min: 1, max: 20, step: 1, label: t("priorityMinGames"), helper: t("priorityMinGamesHelper"), suffix: "" },
                ]).map(({ key, min, max, step, label, helper, suffix }) => (
                  <Box key={key}>
                    <Typography variant="body2" fontWeight={500}>
                      {label}: {localPriority[key]}{suffix ?? ""}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">{helper}</Typography>
                    <Slider
                      value={localPriority[key]}
                      min={min} max={max} step={step ?? 1}
                      onChange={(_, v) => setLocalPriority((s) => s ? { ...s, [key]: v as number } : s)}
                      onChangeCommitted={(_, v) => savePrioritySetting({ [key]: v as number })}
                      disabled={savingPriority}
                      valueLabelDisplay="auto"
                      size="small"
                    />
                  </Box>
                ))}

                {/* Eligibility preview */}
                {priorityData && (
                  <Alert severity="info" icon={false} sx={{ borderRadius: 2 }}>
                    {priorityData.eligible.length > 0
                      ? t("priorityPreview").replace("{n}", String(priorityData.eligible.length))
                      : t("priorityNoEligible")}
                    {" — "}{t("prioritySpotsReserved").replace("{n}", String(priorityData.maxSlots))}
                  </Alert>
                )}
              </Stack>
            )}

            {/* Enrolled players table */}
            {localPriority?.priorityEnabled && priorityData && priorityData.enrollments.length > 0 && (
              <>
                <Divider sx={{ my: 1 }} />
                <Typography variant="subtitle2" fontWeight={600}>{t("priorityPlayerList")}</Typography>
                <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2 }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>{t("name")}</TableCell>
                        <TableCell>Status</TableCell>
                        <TableCell>{t("attendanceRate")}</TableCell>
                        {canEdit && <TableCell />}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {priorityData.enrollments.map((enrollment) => {
                        const eligible = priorityData.eligible.find((e) => e.userId === enrollment.userId);
                        return (
                          <TableRow key={enrollment.userId}>
                            <TableCell>
                              <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                                {enrollment.name}
                                <Chip
                                  label={enrollment.source === "auto" ? t("prioritySourceAuto") : t("prioritySourceManual")}
                                  size="small"
                                  color={enrollment.source === "auto" ? "success" : "info"}
                                  variant="outlined"
                                  sx={{ ml: 0.5 }}
                                />
                              </Box>
                            </TableCell>
                            <TableCell>
                              {!enrollment.optedIn ? (
                                <Chip label={t("priorityOptedOut")} size="small" />
                              ) : enrollment.declineStreak >= 3 ? (
                                <Chip icon={<HourglassEmptyIcon />} label={t("priorityDeclineStreak").replace("{n}", String(enrollment.declineStreak))} size="small" color="warning" />
                              ) : enrollment.noShowStreak >= 2 ? (
                                <Chip icon={<CancelIcon />} label={t("priorityNoShowStreak").replace("{n}", String(enrollment.noShowStreak))} size="small" color="error" />
                              ) : (
                                <Chip icon={<CheckCircleIcon />} label={t("priorityStatusConfirmed")} size="small" color="success" />
                              )}
                            </TableCell>
                            <TableCell>
                              {eligible ? `${Math.round(eligible.attendanceRate * 100)}%` : "—"}
                            </TableCell>
                            {canEdit && (
                              <TableCell>
                                <Tooltip title={t("priorityRemovePlayer")}>
                                  <IconButton size="small" onClick={() => handleRemovePlayer(enrollment.userId)}>
                                    <PersonRemoveIcon fontSize="small" />
                                  </IconButton>
                                </Tooltip>
                              </TableCell>
                            )}
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </TableContainer>
              </>
            )}

            {/* Eligible players preview */}
            {localPriority?.priorityEnabled && priorityData && priorityData.eligible.length > 0 && (
              <>
                <Typography variant="caption" color="text.secondary">
                  {t("priorityPreview").replace("{n}", String(priorityData.eligible.length))}
                </Typography>
                {priorityData.eligible.map((p) => (
                  <Box key={p.userId} sx={{ display: "flex", alignItems: "center", gap: 1, pl: 1 }}>
                    <Typography variant="body2">{p.name}</Typography>
                    <Chip label={`${Math.round(p.attendanceRate * 100)}%`} size="small" color="success" variant="outlined" />
                    <Chip label={`${p.currentStreak} streak`} size="small" variant="outlined" />
                  </Box>
                ))}
              </>
            )}
          </Stack>
        </SectionCard>
      )}

      {/* ── Access Control ── */}
      {isOwner && (
        <SectionCard title={t("accessControl")} icon={<LockIcon color="action" />}>
          <Stack spacing={2}>
            <Typography variant="body2" color="text.secondary">
              {t("accessControlDesc")}
            </Typography>

            {/* Password */}
            <Divider />
            <Typography variant="subtitle2" fontWeight={600}>{t("eventPassword")}</Typography>
            <Typography variant="caption" color="text.secondary">
              {t("eventPasswordHint")}
            </Typography>
            {hasPassword ? (
              <Stack direction="row" spacing={1} alignItems="center">
                <Chip label={t("eventPassword")} icon={<LockIcon />} color="warning" size="small" />
                <Button size="small" color="error" variant="outlined" onClick={handleRemovePassword}>
                  {t("removePassword")}
                </Button>
              </Stack>
            ) : (
              <Stack direction="row" spacing={1} alignItems="center">
                <TextField
                  size="small"
                  type="password"
                  placeholder={t("eventPassword")}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  sx={{ flexGrow: 1 }}
                />
                <Button
                  size="small"
                  variant="contained"
                  onClick={handleSetPassword}
                  disabled={newPassword.length < 4}
                >
                  {t("setPassword")}
                </Button>
              </Stack>
            )}

            {/* Invite list */}
            <Divider />
            <Typography variant="subtitle2" fontWeight={600}>{t("inviteList")}</Typography>
            <Typography variant="caption" color="text.secondary">
              {t("inviteListDesc")}
            </Typography>
            <Stack direction="row" spacing={1} alignItems="center">
              <TextField
                size="small"
                type="email"
                placeholder={t("inviteByEmail")}
                value={inviteEmail}
                onChange={(e) => { setInviteEmail(e.target.value); setInviteError(null); }}
                error={!!inviteError}
                helperText={inviteError}
                sx={{ flexGrow: 1 }}
              />
              <Button
                size="small"
                variant="outlined"
                startIcon={<PersonAddIcon />}
                onClick={handleAddInvite}
                disabled={!inviteEmail.trim()}
              >
                {t("addInvite")}
              </Button>
            </Stack>
            {invites.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ fontStyle: "italic" }}>
                {t("noInvites")}
              </Typography>
            ) : (
              <List dense disablePadding>
                {invites.map((inv) => (
                  <ListItem key={inv.id} disableGutters>
                    <ListItemText
                      primary={inv.name}
                      secondary={inv.email}
                    />
                    <ListItemSecondaryAction>
                      <IconButton edge="end" size="small" onClick={() => handleRemoveInvite(inv.userId)}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </ListItemSecondaryAction>
                  </ListItem>
                ))}
              </List>
            )}
          </Stack>
        </SectionCard>
      )}

      {/* ── Event Admins ── */}
      {isOwner && (
        <SectionCard title={t("eventAdmins")} icon={<GroupIcon color="action" />}>
          <Stack spacing={2}>
            <Typography variant="body2" color="text.secondary">
              {t("eventAdminsDesc")}
            </Typography>
            <Stack direction="row" spacing={1} alignItems="center">
              <TextField
                size="small"
                type="email"
                placeholder={t("adminByEmail")}
                value={adminEmail}
                onChange={(e) => { setAdminEmail(e.target.value); setAdminError(null); }}
                error={!!adminError}
                helperText={adminError}
                sx={{ flexGrow: 1 }}
              />
              <Button
                size="small"
                variant="outlined"
                startIcon={<PersonAddIcon />}
                onClick={handleAddAdmin}
                disabled={!adminEmail.trim()}
              >
                {t("addAdmin")}
              </Button>
            </Stack>
            {admins.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ fontStyle: "italic" }}>
                {t("noAdmins")}
              </Typography>
            ) : (
              <List dense disablePadding>
                {admins.map((adm) => (
                  <ListItem key={adm.id} disableGutters>
                    <ListItemText
                      primary={adm.name}
                      secondary={adm.email}
                    />
                    <ListItemSecondaryAction>
                      <IconButton edge="end" size="small" onClick={() => handleRemoveAdmin(adm.userId)}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </ListItemSecondaryAction>
                  </ListItem>
                ))}
              </List>
            )}
          </Stack>
        </SectionCard>
      )}

      {/* ── Integrations ── */}
      <SectionCard title={t("integrations")} icon={<IntegrationInstructionsIcon color="action" />}>
        <Stack spacing={1}>
          <Typography variant="caption" color="text.secondary">
            {t("webhookHelp")}
          </Typography>
          <Paper variant="outlined" sx={{ borderRadius: 2, p: 1, display: "flex", alignItems: "center", gap: 1 }}>
            <Typography variant="body2" sx={{
              flexGrow: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              fontFamily: "monospace", fontSize: "0.75rem", minWidth: 0,
            }}>
              {typeof window !== "undefined" ? `${window.location.origin}/api/events/${eventId}/webhooks` : ""}
            </Typography>
            <Tooltip title={webhookCopied ? t("webhookCopied") : t("copyLink")}>
              <IconButton size="small" onClick={handleCopyWebhook}>
                <ContentCopyIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Paper>
        </Stack>
      </SectionCard>

      {/* ── Archive ── */}
      {isOwner && (
        <SectionCard title={t("archiveEvent")} icon={<ArchiveIcon color="action" />}>
          <Stack spacing={1}>
            <Typography variant="body2" color="text.secondary">
              {t("archiveEventDesc")}
            </Typography>
            {event.archivedAt && (
              <Chip label={t("archivedBadge")} color="warning" size="small" sx={{ alignSelf: "flex-start" }} />
            )}
            <Button
              variant="outlined"
              color={event.archivedAt ? "primary" : "warning"}
              size="small"
              startIcon={event.archivedAt ? <UnarchiveIcon /> : <ArchiveIcon />}
              onClick={handleArchiveToggle}
              sx={{ alignSelf: "flex-start" }}
            >
              {event.archivedAt ? t("unarchiveEventBtn") : t("archiveEventBtn")}
            </Button>
          </Stack>
        </SectionCard>
      )}

      {/* ── Ownership ── */}
      {isOwner && (
        <SectionCard title={t("ownerBadge")} icon={<StarIcon color="action" />}>
          <Stack spacing={1}>
            <Typography variant="body2" color="text.secondary">
              {t("relinquishOwnershipDesc")}
            </Typography>
            <Button
              variant="outlined"
              color="warning"
              size="small"
              startIcon={<LogoutIcon />}
              onClick={handleRelinquish}
              sx={{ alignSelf: "flex-start" }}
            >
              {t("relinquishOwnership")}
            </Button>
          </Stack>
        </SectionCard>
      )}
    </Stack>
      </ResponsiveLayout>
    </ThemeModeProvider>
  );
}
