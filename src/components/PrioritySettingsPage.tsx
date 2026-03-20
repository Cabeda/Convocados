import React, { useState, useEffect, useCallback } from "react";
import {
  Box, Typography, Stack, Switch, FormControlLabel, Slider, Button, Chip,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Paper, Alert, CircularProgress, IconButton, Tooltip, Divider,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import StarIcon from "@mui/icons-material/Star";
import PersonAddIcon from "@mui/icons-material/PersonAdd";
import PersonRemoveIcon from "@mui/icons-material/PersonRemove";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CancelIcon from "@mui/icons-material/Cancel";
import HourglassEmptyIcon from "@mui/icons-material/HourglassEmpty";
import { useT } from "~/lib/useT";

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

interface IneligiblePlayer {
  userId: string;
  name: string;
  reason: string;
}

interface PriorityData {
  settings: PrioritySettings;
  enrollments: Enrollment[];
  eligible: EligiblePlayer[];
  ineligible: IneligiblePlayer[];
  maxSlots: number;
}

interface Props {
  eventId: string;
  isOwner: boolean;
  isAuthenticated: boolean;
  userId?: string;
  eventTitle: string;
}

export default function PrioritySettingsPage({ eventId, isOwner, isAuthenticated, userId, eventTitle }: Props) {
  const t = useT();
  const [data, setData] = useState<PriorityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [localSettings, setLocalSettings] = useState<PrioritySettings | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/events/${eventId}/priority`);
      if (res.ok) {
        const json = await res.json();
        setData(json);
        setLocalSettings(json.settings);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [eventId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const saveSettings = async (updates: Partial<PrioritySettings>) => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/events/${eventId}/priority`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (res.ok) {
        setMessage({ type: "success", text: t("prioritySettingsSaved") });
        await fetchData();
      } else {
        setMessage({ type: "error", text: t("prioritySettingsError") });
      }
    } catch {
      setMessage({ type: "error", text: t("prioritySettingsError") });
    }
    setSaving(false);
  };

  const handleToggleEnabled = async (enabled: boolean) => {
    setLocalSettings((s) => s ? { ...s, priorityEnabled: enabled } : s);
    await saveSettings({ priorityEnabled: enabled });
  };

  const handleConfirm = async () => {
    try {
      const res = await fetch(`/api/events/${eventId}/priority/confirm`, { method: "POST" });
      if (res.ok) {
        setMessage({ type: "success", text: t("priorityConfirmed") });
        await fetchData();
      }
    } catch { /* ignore */ }
  };

  const handleDecline = async () => {
    try {
      const res = await fetch(`/api/events/${eventId}/priority/decline`, { method: "POST" });
      if (res.ok) {
        setMessage({ type: "success", text: t("priorityDeclinedMsg") });
        await fetchData();
      }
    } catch { /* ignore */ }
  };

  const handleOptOut = async () => {
    try {
      const res = await fetch(`/api/events/${eventId}/priority/opt-out`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      if (res.ok) {
        setMessage({ type: "success", text: t("priorityOptedOutMsg") });
        await fetchData();
      }
    } catch { /* ignore */ }
  };

  const handleOptIn = async () => {
    try {
      const res = await fetch(`/api/events/${eventId}/priority/opt-in`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      if (res.ok) {
        setMessage({ type: "success", text: t("priorityOptedInMsg") });
        await fetchData();
      }
    } catch { /* ignore */ }
  };

  const handleRemovePlayer = async (targetUserId: string) => {
    try {
      const res = await fetch(`/api/events/${eventId}/priority/${targetUserId}`, { method: "DELETE" });
      if (res.ok) await fetchData();
    } catch { /* ignore */ }
  };

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!data || !localSettings) return null;

  const myEnrollment = data.enrollments.find((e) => e.userId === userId);
  const myEligible = data.eligible.find((e) => e.userId === userId);

  return (
    <Stack spacing={3} sx={{ maxWidth: 600, mx: "auto", p: 2 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <IconButton href={`/events/${eventId}`} size="small">
          <ArrowBackIcon />
        </IconButton>
        <Typography variant="h5" fontWeight={700}>{t("priorityEnrollment")}</Typography>
      </Box>

      <Typography variant="body2" color="text.secondary">
        {t("priorityEnrollmentDesc")}
      </Typography>

      {message && (
        <Alert severity={message.type} onClose={() => setMessage(null)}>
          {message.text}
        </Alert>
      )}

      {/* Player status section */}
      {isAuthenticated && userId && localSettings.priorityEnabled && (
        <Paper variant="outlined" sx={{ p: 2 }}>
          {myEnrollment ? (
            <Stack spacing={1}>
              {myEnrollment.optedIn ? (
                <>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <StarIcon color="success" fontSize="small" />
                    <Typography variant="body2">{t("priorityYouQualify")}</Typography>
                  </Box>
                  <Button size="small" variant="outlined" onClick={handleOptOut}>
                    {t("priorityOptOut")}
                  </Button>
                </>
              ) : (
                <>
                  <Typography variant="body2" color="text.secondary">{t("priorityYouOptedOut")}</Typography>
                  <Button size="small" variant="outlined" onClick={handleOptIn}>
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
          ) : myEligible ? (
            <Typography variant="body2" color="text.secondary">
              {t("priorityYouQualify")}
            </Typography>
          ) : (
            <Typography variant="body2" color="text.secondary">
              {t("priorityYouNeedMore").replace("{n}", String(localSettings.priorityMinGames))}
            </Typography>
          )}
        </Paper>
      )}

      {/* Confirm/Decline buttons for pending confirmations would go here */}
      {isAuthenticated && userId && myEnrollment?.optedIn && (
        <Box sx={{ display: "flex", gap: 1 }}>
          <Button variant="contained" color="success" startIcon={<CheckCircleIcon />} onClick={handleConfirm}>
            {t("priorityConfirmSpot")}
          </Button>
          <Button variant="outlined" color="error" startIcon={<CancelIcon />} onClick={handleDecline}>
            {t("priorityDeclineSpot")}
          </Button>
        </Box>
      )}

      {/* Owner settings */}
      {isOwner && (
        <>
          <Divider />
          <Typography variant="h6" fontWeight={600}>{t("eventSettings")}</Typography>

          <FormControlLabel
            control={
              <Switch
                checked={localSettings.priorityEnabled}
                onChange={(e) => handleToggleEnabled(e.target.checked)}
                disabled={saving}
              />
            }
            label={t("priorityEnabled")}
          />

          {localSettings.priorityEnabled && (
            <Stack spacing={2}>
              <Box>
                <Typography variant="body2" gutterBottom>{t("priorityThreshold")}: {localSettings.priorityThreshold}</Typography>
                <Typography variant="caption" color="text.secondary">{t("priorityThresholdHelper")}</Typography>
                <Slider
                  value={localSettings.priorityThreshold}
                  min={1} max={20} step={1}
                  onChange={(_, v) => setLocalSettings((s) => s ? { ...s, priorityThreshold: v as number } : s)}
                  onChangeCommitted={(_, v) => saveSettings({ priorityThreshold: v as number })}
                  disabled={saving}
                  valueLabelDisplay="auto"
                />
              </Box>

              <Box>
                <Typography variant="body2" gutterBottom>{t("priorityWindow")}: {localSettings.priorityWindow}</Typography>
                <Typography variant="caption" color="text.secondary">{t("priorityWindowHelper")}</Typography>
                <Slider
                  value={localSettings.priorityWindow}
                  min={1} max={20} step={1}
                  onChange={(_, v) => setLocalSettings((s) => s ? { ...s, priorityWindow: v as number } : s)}
                  onChangeCommitted={(_, v) => saveSettings({ priorityWindow: v as number })}
                  disabled={saving}
                  valueLabelDisplay="auto"
                />
              </Box>

              <Box>
                <Typography variant="body2" gutterBottom>{t("priorityMaxPercent")}: {localSettings.priorityMaxPercent}%</Typography>
                <Typography variant="caption" color="text.secondary">{t("priorityMaxPercentHelper")}</Typography>
                <Slider
                  value={localSettings.priorityMaxPercent}
                  min={10} max={100} step={5}
                  onChange={(_, v) => setLocalSettings((s) => s ? { ...s, priorityMaxPercent: v as number } : s)}
                  onChangeCommitted={(_, v) => saveSettings({ priorityMaxPercent: v as number })}
                  disabled={saving}
                  valueLabelDisplay="auto"
                />
              </Box>

              <Box>
                <Typography variant="body2" gutterBottom>{t("priorityDeadlineHours")}: {localSettings.priorityDeadlineHours}h</Typography>
                <Typography variant="caption" color="text.secondary">{t("priorityDeadlineHoursHelper")}</Typography>
                <Slider
                  value={localSettings.priorityDeadlineHours}
                  min={0} max={168} step={1}
                  onChange={(_, v) => setLocalSettings((s) => s ? { ...s, priorityDeadlineHours: v as number } : s)}
                  onChangeCommitted={(_, v) => saveSettings({ priorityDeadlineHours: v as number })}
                  disabled={saving}
                  valueLabelDisplay="auto"
                />
              </Box>

              <Box>
                <Typography variant="body2" gutterBottom>{t("priorityMinGames")}: {localSettings.priorityMinGames}</Typography>
                <Typography variant="caption" color="text.secondary">{t("priorityMinGamesHelper")}</Typography>
                <Slider
                  value={localSettings.priorityMinGames}
                  min={1} max={20} step={1}
                  onChange={(_, v) => setLocalSettings((s) => s ? { ...s, priorityMinGames: v as number } : s)}
                  onChangeCommitted={(_, v) => saveSettings({ priorityMinGames: v as number })}
                  disabled={saving}
                  valueLabelDisplay="auto"
                />
              </Box>

              {/* Eligibility preview */}
              <Alert severity="info" icon={false}>
                {data.eligible.length > 0
                  ? t("priorityPreview").replace("{n}", String(data.eligible.length))
                  : t("priorityNoEligible")}
                {" — "}{t("prioritySpotsReserved").replace("{n}", String(data.maxSlots))}
              </Alert>
            </Stack>
          )}
        </>
      )}

      {/* Enrolled players table */}
      {localSettings.priorityEnabled && data.enrollments.length > 0 && (
        <>
          <Divider />
          <Typography variant="h6" fontWeight={600}>{t("priorityPlayerList")}</Typography>
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t("name")}</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>{t("attendanceRate")}</TableCell>
                  {isOwner && <TableCell />}
                </TableRow>
              </TableHead>
              <TableBody>
                {data.enrollments.map((enrollment) => {
                  const eligible = data.eligible.find((e) => e.userId === enrollment.userId);
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
                          <Chip label={t("priorityOptedOut")} size="small" color="default" />
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
                      {isOwner && (
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

      {/* Eligible but not enrolled */}
      {localSettings.priorityEnabled && data.eligible.length > 0 && (
        <>
          <Divider />
          <Typography variant="subtitle2" color="text.secondary">
            {t("priorityPreview").replace("{n}", String(data.eligible.length))}
          </Typography>
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t("name")}</TableCell>
                  <TableCell>{t("attendanceRate")}</TableCell>
                  <TableCell>{t("currentStreak")}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.eligible.map((p) => (
                  <TableRow key={p.userId}>
                    <TableCell>{p.name}</TableCell>
                    <TableCell>{Math.round(p.attendanceRate * 100)}%</TableCell>
                    <TableCell>{p.currentStreak}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      )}
    </Stack>
  );
}
