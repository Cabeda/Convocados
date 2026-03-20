import React, { useState, useEffect, useCallback } from "react";
import {
  Box, Typography, Stack, Switch, FormControlLabel, Slider, Button, Chip,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Paper, Alert, CircularProgress, IconButton, Tooltip, Divider,
  FormControl, Select, MenuItem, Card, CardContent, CardHeader,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import PublicIcon from "@mui/icons-material/Public";
import BalanceIcon from "@mui/icons-material/Balance";
import StarIcon from "@mui/icons-material/Star";
import PersonRemoveIcon from "@mui/icons-material/PersonRemove";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CancelIcon from "@mui/icons-material/Cancel";
import HourglassEmptyIcon from "@mui/icons-material/HourglassEmpty";
import IntegrationInstructionsIcon from "@mui/icons-material/IntegrationInstructions";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import LogoutIcon from "@mui/icons-material/Logout";
import SwapHorizIcon from "@mui/icons-material/SwapHoriz";
import { useT } from "~/lib/useT";
import { SPORT_PRESETS, getSportPreset } from "~/lib/sports";
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

  useEffect(() => {
    fetchEvent();
    fetchPriority();
  }, [fetchEvent, fetchPriority]);

  // Derived state
  const isAuthenticated = !!session?.user;
  const isOwner = !!(session?.user && event?.ownerId && session.user.id === event.ownerId);
  const isOwnerless = event && !event.ownerId;
  const canEdit = isOwnerless || isOwner;
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

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!event) return null;

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
            <Tooltip title={t("balancedTeamsTooltip")}>
              <FormControlLabel
                control={<Switch size="small" checked={event.balanced} onChange={(e) => handleToggleBalanced(e.target.checked)} disabled={!canEdit} />}
                label={<Typography variant="body2">{t("balancedTeams")}</Typography>}
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
