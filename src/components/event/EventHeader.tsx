/* eslint-disable @eslint-react/purity -- React Compiler hint, not a bug. Date objects during render are common and necessary for time-based UI (countdown, past detection, etc.) */
import React, { useState, useEffect, useRef } from "react";
import {
  Paper, Typography, Box, Stack, Chip, Button, IconButton,
  TextField, Tooltip, alpha, useTheme, useMediaQuery, Menu, MenuItem,
  ListItemIcon, ListItemText, Select, FormControl, Divider,
} from "@mui/material";
import AccessTimeIcon from "@mui/icons-material/AccessTime";
import LocationOnIcon from "@mui/icons-material/LocationOn";
import HistoryIcon from "@mui/icons-material/History";
import SettingsIcon from "@mui/icons-material/Settings";
import SportsSoccerIcon from "@mui/icons-material/SportsSoccer";
import EmojiEventsIcon from "@mui/icons-material/EmojiEvents";
import EditIcon from "@mui/icons-material/Edit";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import NotificationsIcon from "@mui/icons-material/Notifications";
import AssignmentIcon from "@mui/icons-material/Assignment";
import EmojiPeopleIcon from "@mui/icons-material/EmojiPeople";
import CalendarMonthIcon from "@mui/icons-material/CalendarMonth";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import { useT } from "~/lib/useT";
import { detectLocale } from "~/lib/i18n";
import { describeRecurrenceRule, parseRecurrenceRule, nextOccurrence } from "~/lib/recurrence";
import { SPORT_PRESETS } from "~/lib/sports";
import { googleCalendarUrl } from "~/lib/calendar";
import { COMMON_TIMEZONES, formatDateInTz, toDateTimeLocalValue } from "~/lib/timezones";
import type { EventData } from "./types";
import type { Imatch } from "~/lib/random";
import { ShareBar } from "./ShareBar";
import { NotifyButton } from "./NotifyButton";
import { MyNotificationsDialog } from "./MyNotificationsDialog";
import LocationAutocomplete from "../LocationAutocomplete";
import CourtAlternatives from "../CourtAlternatives";
import { isPlaytomicSport } from "~/lib/playtomic";

interface Props {
  eventId: string;
  event: EventData;
  sport: string;
  gameDate: Date;
  countdown: string;
  canEditSettings: boolean;
  isOwner: boolean;
  isAuthenticated: boolean;
  isOwnerless: boolean;
  localMatches: Imatch[] | null;
  onSaveTitle: (title: string) => Promise<void>;
  onSaveLocation: (location: string) => Promise<void>;
  onSaveDateTime: (dateTime: string, timezone: string) => Promise<void>;
  onSaveSport: (sport: string) => Promise<void>;
  onClaimOwnership: () => Promise<void>;
  onSnackbar: (msg: string) => void;
}

function countdownUrgency(gameDate: Date, durationMinutes?: number): "past" | "live" | "urgent" | "soon" | "normal" {
  const now = Date.now();
  const start = gameDate.getTime();
  const end = start + (durationMinutes ?? 60) * 60_000;
  if (now >= start && now < end) return "live";
  if (now >= end) return "past";
  if (start - now < 2 * 60 * 60 * 1000) return "urgent";
  if (start - now < 24 * 60 * 60 * 1000) return "soon";
  return "normal";
}

export function EventHeader({
  eventId, event, sport, gameDate, countdown, canEditSettings,
  isOwner: _isOwner, isAuthenticated, isOwnerless, localMatches,
  onSaveTitle, onSaveLocation, onSaveDateTime, onSaveSport, onClaimOwnership,
}: Props) {
  const t = useT();
  const locale = detectLocale();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const isPast = gameDate < new Date();

  // ── Edit mode ────────────────────────────────────────────────────────────────
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [locationDraft, setLocationDraft] = useState("");
  const [dateTimeDraft, setDateTimeDraft] = useState("");
  const [timezoneDraft, setTimezoneDraft] = useState("UTC");
  const [sportDraft, setSportDraft] = useState("");
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [notifDialogOpen, setNotifDialogOpen] = useState(false);

  // ── Ref for the main card ────────────────────────────────────────────────────
  const cardRef = useRef<HTMLDivElement>(null);

  // ── Keyboard shortcut `e` ────────────────────────────────────────────────────
  useEffect(() => {
    if (!canEditSettings) return;
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "e" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setEditMode((prev) => {
          if (!prev) {
            setTitleDraft(event.title);
            setLocationDraft(event.location || "");
            setDateTimeDraft(toDateTimeLocalValue(new Date(event.dateTime), event.timezone || "UTC"));
            setTimezoneDraft(event.timezone || "UTC");
            setSportDraft(sport);
          }
          return !prev;
        });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [canEditSettings, event, sport]);

  const rule = parseRecurrenceRule(event.recurrenceRule);
  const urgency = countdownUrgency(gameDate, event.durationMinutes);
  // ponytail: recurring events in past phase get primary color (next game exists),
  // non-recurring past events get the muted grey.
  const isRecurringPast = urgency === "past" && !!rule;
  const urgencyColor = urgency === "past" && !isRecurringPast ? theme.palette.text.disabled
    : urgency === "past" && isRecurringPast ? theme.palette.primary.main
    : urgency === "live" ? theme.palette.success.main
    : urgency === "urgent" ? theme.palette.error.main
    : urgency === "soon" ? theme.palette.warning.main
    : theme.palette.primary.main;
  const urgencyBg = urgency === "past" && !isRecurringPast ? alpha(theme.palette.text.disabled, 0.06)
    : urgency === "past" && isRecurringPast ? alpha(theme.palette.primary.main, 0.08)
    : urgency === "live" ? alpha(theme.palette.success.main, 0.1)
    : urgency === "urgent" ? alpha(theme.palette.error.main, 0.1)
    : urgency === "soon" ? alpha(theme.palette.warning.main, 0.1)
    : alpha(theme.palette.primary.main, 0.08);
  const accentOpacity = urgency === "normal" ? 0.25 : (urgency === "past" && !isRecurringPast) ? 0.15 : 0.8;

  const openEdit = () => {
    setTitleDraft(event.title);
    setLocationDraft(event.location || "");
    setDateTimeDraft(toDateTimeLocalValue(new Date(event.dateTime), event.timezone || "UTC"));
    setTimezoneDraft(event.timezone || "UTC");
    setSportDraft(sport);
    setEditMode(true);
  };

  const cancelEdit = () => setEditMode(false);

  const saveAll = async () => {
    setSaving(true);
    const promises: Promise<void>[] = [];
    if (titleDraft.trim() && titleDraft.trim() !== event.title) {
      promises.push(onSaveTitle(titleDraft.trim()));
    }
    if (locationDraft !== (event.location || "")) {
      promises.push(onSaveLocation(locationDraft));
    }
    if (dateTimeDraft !== toDateTimeLocalValue(new Date(event.dateTime), event.timezone || "UTC") || timezoneDraft !== (event.timezone || "UTC")) {
      promises.push(onSaveDateTime(dateTimeDraft, timezoneDraft));
    }
    if (sportDraft && sportDraft !== sport) {
      promises.push(onSaveSport(sportDraft));
    }
    await Promise.all(promises);
    setSaving(false);
    setEditMode(false);
    // Brief "Saved" flash
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 2000);
  };

  // ── Derived ──────────────────────────────────────────────────────────────────

  const formattedDate = formatDateInTz(gameDate, locale === "pt" ? "pt-PT" : "en-GB", event.timezone, {
    weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });

  // ponytail: adaptive time line — one line that changes based on urgency phase.
  // Upgrade path: add "live" score indicator inline when live scoring is implemented.
  const recurrenceDesc = rule ? describeRecurrenceRule(rule, locale) : null;
  const timeLine = (() => {
    switch (urgency) {
      case "normal": // >24h — show full date, append recurrence
        return recurrenceDesc ? `${formattedDate} · ${recurrenceDesc}` : formattedDate;
      case "soon": // <24h — countdown primary, short time secondary
        return countdown;
      case "urgent": // <2h — countdown only
        return countdown;
      case "live":
        return t("liveNow");
      case "past":
        // For recurring events, show the actual next game date so new players know when to come
        if (rule) {
          const nextDate = nextOccurrence(gameDate, rule, new Date());
          const nextFormatted = formatDateInTz(nextDate, locale === "pt" ? "pt-PT" : "en-GB", event.timezone, {
            weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
          });
          return `${t("nextGame")}: ${nextFormatted}`;
        }
        return t("eventEnded");
    }
  })();
  // Secondary hint: show date context when countdown is primary, or recurrence pattern when past+recurring
  const timeLineSecondary = (urgency === "soon" || urgency === "urgent")
    ? formattedDate
    : (urgency === "past" && recurrenceDesc)
      ? recurrenceDesc
      : null;

  // Viewer's timezone differs from event's timezone?
  const viewerTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const tzLabel = event.timezone && event.timezone !== "UTC" && event.timezone !== viewerTz
    ? COMMON_TIMEZONES.find((tz) => tz.value === event.timezone)?.label ?? event.timezone
    : null;

  const locationHref = event.location
    ? (/^https?:\/\//i.test(event.location)
        ? event.location
        : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.location)}`)
    : null;

  const calendarHref = googleCalendarUrl({
    id: eventId, title: event.title, location: event.location, dateTime: gameDate,
    url: typeof window !== "undefined" ? window.location.href : undefined,
    recurrence: event.isRecurring && event.recurrenceRule ? JSON.parse(event.recurrenceRule) : undefined,
  });

  return (
    <>
      {/* ── Main card ── */}
      <Paper ref={cardRef} elevation={2} sx={{ borderRadius: 3, overflow: "hidden" }}>

        {/* Urgency accent bar */}
        <Box sx={{ height: 3, backgroundColor: urgencyColor, opacity: accentOpacity }} />

        {/* Saved flash overlay */}
        {savedFlash && (
          <Box sx={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 0.5,
            py: 0.5, backgroundColor: alpha(theme.palette.success.main, 0.12),
          }}>
            <CheckCircleOutlineIcon sx={{ fontSize: 14, color: "success.main" }} />
            <Typography variant="caption" color="success.main" fontWeight={600}>{t("saved")}</Typography>
          </Box>
        )}

        <Box sx={{ p: { xs: 2, sm: 3 } }}>
          <Stack spacing={2}>

            {/* ── Row 1: Title + edit toggle ── */}
            <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1 }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                {editMode ? (
                  <TextField
                    size="small" value={titleDraft} fullWidth autoFocus
                    label={t("gameTitle")}
                    onChange={(e) => setTitleDraft(e.target.value)}
                    inputProps={{ maxLength: 100 }}
                    onKeyDown={(e) => { if (e.key === "Escape") cancelEdit(); }}
                  />
                ) : (
                  <Typography
                    variant="h5" fontWeight={700}
                    sx={{ wordBreak: "break-word", lineHeight: 1.2, color: isPast ? "text.secondary" : "text.primary" }}
                  >
                    {event.title}
                  </Typography>
                )}
                {!editMode && event.ownerName && (
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 0.25, display: "block" }}>
                    {t("managedBy", { name: "" })}
                    <a href={`/users/${event.ownerId}`} style={{ textDecoration: "none", color: "inherit", fontWeight: 600 }}>
                      {event.ownerName}
                    </a>
                  </Typography>
                )}
              </Box>

              {canEditSettings && (
                editMode ? (
                  <Stack direction="row" spacing={0.5} sx={{ flexShrink: 0 }}>
                    <Tooltip title={t("saveDateTime")}>
                      <IconButton size="small" color="primary" onClick={saveAll} disabled={saving}>
                        <CheckIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title={t("cancelEdit")}>
                      <IconButton size="small" onClick={cancelEdit} disabled={saving}>
                        <CloseIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                ) : (
                  <Tooltip title={`${t("editDateTime")} (e)`}>
                    <IconButton
                      size="small" onClick={openEdit}
                      sx={{
                        flexShrink: 0,
                        opacity: { xs: 1, sm: 0 },
                        ".MuiPaper-root:hover &": { opacity: 1 },
                        transition: "opacity 0.15s",
                      }}
                    >
                      <EditIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                )
              )}
            </Box>

            {/* ── Row 2: Adaptive time line ── */}
            {!editMode && (
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                <Box sx={{
                  display: "inline-flex", alignItems: "center", gap: 0.75,
                  px: 1.5, py: 0.5, borderRadius: 2, backgroundColor: urgencyBg,
                }}>
                  {urgency === "live" && (
                    <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: urgencyColor, animation: "pulse 1.5s infinite", "@keyframes pulse": { "0%,100%": { opacity: 1 }, "50%": { opacity: 0.4 } } }} />
                  )}
                  {urgency !== "live" && <AccessTimeIcon sx={{ color: urgencyColor, fontSize: 16 }} />}
                  <Typography variant="body2" fontWeight={700} sx={{ color: urgencyColor }}>
                    {timeLine}
                  </Typography>
                </Box>
                {timeLineSecondary && (
                  <Typography variant="caption" color="text.secondary">
                    {timeLineSecondary}
                    {tzLabel && ` (${tzLabel})`}
                  </Typography>
                )}
                {!timeLineSecondary && tzLabel && (
                  <Typography variant="caption" color="text.disabled">
                    ({tzLabel})
                  </Typography>
                )}
              </Box>
            )}

            {/* ── Row 4: Date + Location (edit or read) ── */}
            {editMode ? (
              <Stack spacing={1.5}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <AccessTimeIcon fontSize="small" color="action" sx={{ flexShrink: 0 }} />
                  <TextField
                    size="small" type="datetime-local" value={dateTimeDraft}
                    onChange={(e) => setDateTimeDraft(e.target.value)}
                    InputLabelProps={{ shrink: true }} label={t("dateTime")} sx={{ flex: 1 }}
                  />
                </Box>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <AccessTimeIcon fontSize="small" color="action" sx={{ flexShrink: 0, opacity: 0 }} />
                  <FormControl size="small" fullWidth>
                    <Select value={timezoneDraft} onChange={(e) => setTimezoneDraft(e.target.value)} displayEmpty>
                      {COMMON_TIMEZONES.map((tz) => (
                        <MenuItem key={tz.value} value={tz.value} sx={{ fontSize: "0.85rem" }}>{tz.label}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Box>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <LocationOnIcon fontSize="small" color="action" sx={{ flexShrink: 0 }} />
                  <LocationAutocomplete
                    value={locationDraft}
                    onChange={setLocationDraft}
                    label={t("location")}
                    placeholder={t("locationPlaceholder")}
                    size="small"
                  />
                </Box>
                {/* Court alternatives — shown in edit mode near location */}
                {isPlaytomicSport(sport) && (
                  <CourtAlternatives
                    eventId={eventId}
                    sport={sport}
                    hasCoordinates={!!(event.latitude && event.longitude)}
                    courtWatchConfig={event.courtWatchConfig ? JSON.parse(event.courtWatchConfig) : null}
                    gameTime={(() => { const parts = new Intl.DateTimeFormat("en-GB", { timeZone: event.timezone || "UTC", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(gameDate); const h = parts.find(p => p.type === "hour")?.value ?? "00"; const m = parts.find(p => p.type === "minute")?.value ?? "00"; return `${h}:${m}`; })()}
                  />
                )}
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <SportsSoccerIcon fontSize="small" color="action" sx={{ flexShrink: 0 }} />
                  <FormControl size="small" fullWidth>
                    <Select value={sportDraft} onChange={(e) => setSportDraft(e.target.value)}>
                      {SPORT_PRESETS.map((s) => (
                        <MenuItem key={s.id} value={s.id} sx={{ fontSize: "0.85rem" }}>
                          {t(s.labelKey)}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Box>
              </Stack>
            ) : (
              <Stack spacing={0.75}>
                {/* Location row — hidden for non-editors when empty */}
                {(event.location || canEditSettings) && (
                  <Box
                    component={locationHref ? "a" : "div"}
                    href={locationHref ?? undefined}
                    target={locationHref ? "_blank" : undefined}
                    rel={locationHref ? "noopener noreferrer" : undefined}
                    sx={{
                      display: "flex", alignItems: "center", gap: 0.75,
                      textDecoration: "none", color: "inherit", borderRadius: 1,
                      ...(locationHref ? {
                        cursor: "pointer",
                        "&:hover .loc-text": { color: "primary.main", textDecoration: "underline" },
                      } : {}),
                    }}
                  >
                    <LocationOnIcon fontSize="small" color={locationHref ? "primary" : "disabled"} />
                    <Typography
                      className="loc-text"
                      variant="body2"
                      color={event.location ? "text.secondary" : "text.disabled"}
                      sx={{ transition: "color 0.15s" }}
                    >
                      {event.location || t("locationOptional")}
                    </Typography>
                  </Box>
                )}
              </Stack>
            )}

            {/* ── Row 5: Contextual chips (minimal — only show what's actionable/critical) ── */}
            {!editMode && (event.archivedAt || (isAuthenticated && isOwnerless)) && (
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap" }}>
                {event.archivedAt && (
                  <Chip label={t("archivedBadge")} size="small" color="warning" variant="outlined" />
                )}
                {isAuthenticated && isOwnerless && (
                  <Button variant="outlined" size="small" color="secondary" onClick={onClaimOwnership}
                    sx={{ height: 24, fontSize: "0.75rem", py: 0 }}>
                    {t("claimOwnership")}
                  </Button>
                )}
              </Box>
            )}

            <Divider />

            {/* ── Row 6: Actions — hide share/notify/calendar in past phase ── */}
            <Box sx={{ display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap" }}>
              {urgency !== "past" && (
                <ShareBar
                  title={event.title} dateTime={gameDate} timezone={event.timezone} location={event.location}
                  maxPlayers={event.maxPlayers} playerCount={event.players.length}
                />
              )}

              {isMobile ? (
                <>
                  <NotifyButton eventId={eventId} isAuthenticated={isAuthenticated} />
                  <IconButton
                    onClick={(e) => setAnchorEl(e.currentTarget)}
                    aria-label={t("moreActions")}
                    size="small"
                    sx={{ border: 1, borderColor: "divider", ml: "auto" }}
                  >
                    <MoreVertIcon fontSize="small" />
                  </IconButton>
                </>
              ) : (
                <>
                  <NotifyButton eventId={eventId} isAuthenticated={isAuthenticated} />
                  <Button variant="outlined" size="small" startIcon={<MoreVertIcon />}
                    onClick={(e) => setAnchorEl(e.currentTarget)}
                    sx={{ ml: "auto", flexShrink: 0 }}>
                    {t("moreActions")}
                  </Button>
                </>
              )}

              <Menu anchorEl={anchorEl} open={!!anchorEl} onClose={() => setAnchorEl(null)}>
                {isMobile && localMatches && localMatches.length > 0 && (
                  <MenuItem component="a" href={`/watch/${eventId}`} target="_blank" onClick={() => setAnchorEl(null)}>
                    <ListItemIcon><SportsSoccerIcon fontSize="small" /></ListItemIcon>
                    <ListItemText>{t("watchScore")}</ListItemText>
                  </MenuItem>
                )}
                <MenuItem component="a" href={`/events/${eventId}/history`} onClick={() => setAnchorEl(null)}>
                  <ListItemIcon><HistoryIcon fontSize="small" /></ListItemIcon>
                  <ListItemText>{t("history")}</ListItemText>
                </MenuItem>
                {(isPast || event.isRecurring) && (
                  <MenuItem component="a" href={`/events/${eventId}/attendance`} onClick={() => setAnchorEl(null)}>
                    <ListItemIcon><EmojiPeopleIcon fontSize="small" /></ListItemIcon>
                    <ListItemText>{t("attendance")}</ListItemText>
                  </MenuItem>
                )}
                {(event.eloEnabled ?? true) && (event.showCompetitiveData ?? true) && (
                  <MenuItem component="a" href={`/events/${eventId}/rankings`} onClick={() => setAnchorEl(null)}>
                    <ListItemIcon><EmojiEventsIcon fontSize="small" /></ListItemIcon>
                    <ListItemText>{t("ratings")}</ListItemText>
                  </MenuItem>
                )}
                <Divider sx={{ my: 0.5 }} />
                <MenuItem component="a" href={`/events/${eventId}/log`} onClick={() => setAnchorEl(null)}>
                  <ListItemIcon><AssignmentIcon fontSize="small" /></ListItemIcon>
                  <ListItemText>{t("activityLog")}</ListItemText>
                </MenuItem>
                {urgency !== "past" && (
                  <MenuItem component="a" href={`/api/events/${eventId}/calendar`} onClick={() => setAnchorEl(null)}>
                    <ListItemIcon><CalendarMonthIcon fontSize="small" /></ListItemIcon>
                    <ListItemText>{t("downloadIcs")}</ListItemText>
                  </MenuItem>
                )}
                {urgency !== "past" && (
                  <MenuItem component="a" href={calendarHref} target="_blank" rel="noopener noreferrer"
                    onClick={() => setAnchorEl(null)}>
                    <ListItemIcon><CalendarMonthIcon fontSize="small" /></ListItemIcon>
                    <ListItemText>{t("addToGoogleCalendar")}</ListItemText>
                  </MenuItem>
                )}
                {isAuthenticated && (
                  <>
                    <Divider sx={{ my: 0.5 }} />
                    <MenuItem onClick={() => { setAnchorEl(null); setNotifDialogOpen(true); }}>
                      <ListItemIcon><NotificationsIcon fontSize="small" /></ListItemIcon>
                      <ListItemText>{t("myNotificationsMenu")}</ListItemText>
                    </MenuItem>
                  </>
                )}
                {canEditSettings && <Divider sx={{ my: 0.5 }} />}
                {canEditSettings && (
                  <MenuItem component="a" href={`/events/${eventId}/settings`} onClick={() => setAnchorEl(null)}>
                    <ListItemIcon><SettingsIcon fontSize="small" /></ListItemIcon>
                    <ListItemText>{t("eventSettings")}</ListItemText>
                  </MenuItem>
                )}
              </Menu>
            </Box>

            {/* Per-user notification settings dialog */}
            <MyNotificationsDialog eventId={eventId} open={notifDialogOpen} onClose={() => setNotifDialogOpen(false)} />

          </Stack>
        </Box>
      </Paper>
    </>
  );
}
