import React, { useState } from "react";
import {
  Paper, Typography, Box, Stack, Chip, Button, IconButton,
  TextField, Tooltip, alpha, useTheme, useMediaQuery, Menu, MenuItem,
  ListItemIcon, ListItemText, Select, FormControl, Divider,
} from "@mui/material";
import AccessTimeIcon from "@mui/icons-material/AccessTime";
import LocationOnIcon from "@mui/icons-material/LocationOn";
import EventRepeatIcon from "@mui/icons-material/EventRepeat";
import HistoryIcon from "@mui/icons-material/History";
import SettingsIcon from "@mui/icons-material/Settings";
import SportsSoccerIcon from "@mui/icons-material/SportsSoccer";
import StarIcon from "@mui/icons-material/Star";
import EmojiEventsIcon from "@mui/icons-material/EmojiEvents";
import EditIcon from "@mui/icons-material/Edit";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import AssignmentIcon from "@mui/icons-material/Assignment";
import EmojiPeopleIcon from "@mui/icons-material/EmojiPeople";
import CalendarMonthIcon from "@mui/icons-material/CalendarMonth";
import { useT } from "~/lib/useT";
import { detectLocale } from "~/lib/i18n";
import { describeRecurrenceRule, parseRecurrenceRule } from "~/lib/recurrence";
import { getSportPreset, SPORT_PRESETS } from "~/lib/sports";
import { googleCalendarUrl } from "~/lib/calendar";
import { COMMON_TIMEZONES } from "~/lib/timezones";
import type { EventData } from "./types";
import type { Imatch } from "~/lib/random";
import { ShareBar } from "./ShareBar";
import { NotifyButton } from "./NotifyButton";
import { WatchScoreButton } from "./WatchScoreButton";

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

/** Returns urgency level based on time until game */
function countdownUrgency(gameDate: Date): "past" | "urgent" | "soon" | "normal" {
  const ms = gameDate.getTime() - Date.now();
  if (ms < 0) return "past";
  if (ms < 2 * 60 * 60 * 1000) return "urgent";   // < 2h
  if (ms < 24 * 60 * 60 * 1000) return "soon";     // < 24h
  return "normal";
}

export function EventHeader({
  eventId, event, sport, gameDate, countdown, canEditSettings,
  isOwner, isAuthenticated, isOwnerless, localMatches,
  onSaveTitle, onSaveLocation, onSaveDateTime, onSaveSport, onClaimOwnership,
}: Props) {
  const t = useT();
  const locale = detectLocale();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const rule = parseRecurrenceRule(event.recurrenceRule);

  const [editMode, setEditMode] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [locationDraft, setLocationDraft] = useState("");
  const [dateTimeDraft, setDateTimeDraft] = useState("");
  const [timezoneDraft, setTimezoneDraft] = useState("UTC");
  const [sportDraft, setSportDraft] = useState("");
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);

  const urgency = countdownUrgency(gameDate);
  const urgencyColor = urgency === "urgent" ? theme.palette.error.main
    : urgency === "soon" ? theme.palette.warning.main
    : theme.palette.primary.main;
  const urgencyBg = urgency === "urgent" ? alpha(theme.palette.error.main, 0.1)
    : urgency === "soon" ? alpha(theme.palette.warning.main, 0.1)
    : alpha(theme.palette.primary.main, 0.08);

  const openEdit = () => {
    setTitleDraft(event.title);
    setLocationDraft(event.location || "");
    setDateTimeDraft(event.dateTime.slice(0, 16));
    setTimezoneDraft(event.timezone || "UTC");
    setSportDraft(sport);
    setEditMode(true);
  };

  const cancelEdit = () => setEditMode(false);

  const saveAll = async () => {
    const promises: Promise<void>[] = [];
    if (titleDraft.trim() && titleDraft.trim() !== event.title) {
      promises.push(onSaveTitle(titleDraft.trim()));
    }
    if (locationDraft !== event.location) {
      promises.push(onSaveLocation(locationDraft));
    }
    if (dateTimeDraft !== event.dateTime.slice(0, 16) || timezoneDraft !== (event.timezone || "UTC")) {
      promises.push(onSaveDateTime(dateTimeDraft, timezoneDraft));
    }
    if (sportDraft && sportDraft !== sport) {
      promises.push(onSaveSport(sportDraft));
    }
    await Promise.all(promises);
    setEditMode(false);
  };

  const playerCount = event.players.length;

  const formattedDate = gameDate.toLocaleString(locale === "pt" ? "pt-PT" : "en-GB", {
    weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });

  const tzLabel = event.timezone && event.timezone !== "UTC"
    ? COMMON_TIMEZONES.find((tz) => tz.value === event.timezone)?.label ?? event.timezone
    : null;

  const locationHref = event.location
    ? (/^https?:\/\//i.test(event.location)
        ? event.location
        : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.location)}`)
    : null;

  return (
    <Paper elevation={2} sx={{ borderRadius: 3, overflow: "hidden" }}>

      {/* ── Urgency accent bar ── */}
      <Box sx={{ height: 3, backgroundColor: urgencyColor, opacity: urgency === "normal" ? 0.3 : 0.8 }} />

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
                <Typography variant="h5" fontWeight={700} sx={{ wordBreak: "break-word", lineHeight: 1.2 }}>
                  {event.title}
                </Typography>
              )}

              {/* Owner subtitle — compact, below title */}
              {!editMode && event.ownerName && (
                <Typography variant="caption" color="text.secondary" sx={{ mt: 0.25, display: "block" }}>
                  {t("managedBy", { name: "" })}
                  <a href={`/users/${event.ownerId}`} style={{ textDecoration: "none", color: "inherit", fontWeight: 600 }}>
                    {event.ownerName}
                  </a>
                </Typography>
              )}
            </Box>

            {/* Edit toggle — top-right */}
            {canEditSettings && (
              editMode ? (
                <Stack direction="row" spacing={0.5} sx={{ flexShrink: 0 }}>
                  <Tooltip title={t("saveLocation")}>
                    <IconButton size="small" color="primary" onClick={saveAll}>
                      <CheckIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title={t("cancelEdit")}>
                    <IconButton size="small" onClick={cancelEdit}>
                      <CloseIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Stack>
              ) : (
                <Tooltip title={t("editDateTime")}>
                  <IconButton
                    size="small"
                    onClick={openEdit}
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

          {/* ── Row 2: Countdown pill (prominent) ── */}
          {!editMode && (
            <Box sx={{
              display: "inline-flex", alignItems: "center", gap: 1,
              px: 2, py: 0.75, borderRadius: 2, width: "fit-content",
              backgroundColor: urgencyBg,
            }}>
              <AccessTimeIcon sx={{ color: urgencyColor, fontSize: 18 }} />
              <Typography variant="body1" fontWeight={700} sx={{ color: urgencyColor }}>
                {countdown}
              </Typography>
            </Box>
          )}

          {/* ── Row 3: Date + Location (edit or read) ── */}
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
                <TextField
                  size="small" value={locationDraft} fullWidth label={t("location")}
                  onChange={(e) => setLocationDraft(e.target.value)}
                  placeholder={t("locationPlaceholder")} inputProps={{ maxLength: 200 }}
                />
              </Box>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <SportsSoccerIcon fontSize="small" color="action" sx={{ flexShrink: 0 }} />
                <FormControl size="small" fullWidth>
                  <Select value={sportDraft} onChange={(e) => setSportDraft(e.target.value)}>
                    {SPORT_PRESETS.map((s) => (
                      <MenuItem key={s.id} value={s.id} sx={{ fontSize: "0.85rem" }}>
                        {t(s.labelKey as any)}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Box>
            </Stack>
          ) : (
            <Stack spacing={0.75}>
              {/* Date row */}
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
                <AccessTimeIcon fontSize="small" color="action" />
                <Typography variant="body2" color="text.secondary">
                  {formattedDate}
                  {tzLabel && (
                    <Typography component="span" variant="caption" color="text.disabled" sx={{ ml: 0.5 }}>
                      ({tzLabel})
                    </Typography>
                  )}
                </Typography>
              </Box>

              {/* Location row — full row is tappable */}
              <Box
                component={locationHref ? "a" : "div"}
                href={locationHref ?? undefined}
                target={locationHref ? "_blank" : undefined}
                rel={locationHref ? "noopener noreferrer" : undefined}
                sx={{
                  display: "flex", alignItems: "center", gap: 0.75,
                  textDecoration: "none", color: "inherit",
                  borderRadius: 1,
                  ...(locationHref ? {
                    cursor: "pointer",
                    "&:hover": { "& .loc-text": { color: "primary.main", textDecoration: "underline" } },
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
            </Stack>
          )}

          {/* ── Row 4: Chips — sport, recurrence, badges ── */}
          {!editMode && (
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap" }}>
              <Chip
                icon={<SportsSoccerIcon />}
                label={t(getSportPreset(sport).labelKey as any)}
                size="small" color="primary" variant="outlined"
              />
              {rule && (
                <Chip icon={<EventRepeatIcon />} label={describeRecurrenceRule(rule, locale)}
                  size="small" color="secondary" />
              )}
              {isOwner && (
                <Chip icon={<StarIcon />} label={t("ownerBadge")} size="small" color="success" variant="outlined" />
              )}
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

          {/* ── Row 5: Actions ── */}
          <Box sx={{ display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap" }}>
            <ShareBar
              title={event.title} dateTime={gameDate} location={event.location}
              maxPlayers={event.maxPlayers} playerCount={playerCount}
            />

            {isMobile ? (
              <>
                <NotifyButton eventId={eventId} />
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
                <NotifyButton eventId={eventId} />
                {localMatches && localMatches.length > 0 && <WatchScoreButton eventId={eventId} />}
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
              {(gameDate <= new Date() || event.isRecurring) && (
                <MenuItem component="a" href={`/events/${eventId}/history`} onClick={() => setAnchorEl(null)}>
                  <ListItemIcon><HistoryIcon fontSize="small" /></ListItemIcon>
                  <ListItemText>{t("history")}</ListItemText>
                </MenuItem>
              )}
              {(gameDate <= new Date() || event.isRecurring) && (
                <MenuItem component="a" href={`/events/${eventId}/attendance`} onClick={() => setAnchorEl(null)}>
                  <ListItemIcon><EmojiPeopleIcon fontSize="small" /></ListItemIcon>
                  <ListItemText>{t("attendance")}</ListItemText>
                </MenuItem>
              )}
              {(event.eloEnabled ?? true) && (
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
              <MenuItem component="a" href={`/api/events/${eventId}/calendar`} onClick={() => setAnchorEl(null)}>
                <ListItemIcon><CalendarMonthIcon fontSize="small" /></ListItemIcon>
                <ListItemText>{t("downloadIcs")}</ListItemText>
              </MenuItem>
              <MenuItem component="a"
                href={googleCalendarUrl({
                  id: eventId, title: event.title, location: event.location, dateTime: gameDate,
                  url: typeof window !== "undefined" ? window.location.href : undefined,
                  recurrence: event.isRecurring && event.recurrenceRule ? JSON.parse(event.recurrenceRule) : undefined,
                })}
                target="_blank" rel="noopener noreferrer"
                onClick={() => setAnchorEl(null)}>
                <ListItemIcon><CalendarMonthIcon fontSize="small" /></ListItemIcon>
                <ListItemText>{t("addToGoogleCalendar")}</ListItemText>
              </MenuItem>
              {canEditSettings && <Divider sx={{ my: 0.5 }} />}
              {canEditSettings && (
                <MenuItem component="a" href={`/events/${eventId}/settings`} onClick={() => setAnchorEl(null)}>
                  <ListItemIcon><SettingsIcon fontSize="small" /></ListItemIcon>
                  <ListItemText>{t("eventSettings")}</ListItemText>
                </MenuItem>
              )}
            </Menu>
          </Box>

        </Stack>
      </Box>
    </Paper>
  );
}
