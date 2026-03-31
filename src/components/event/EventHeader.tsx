import React, { useState } from "react";
import {
  Paper, Typography, Box, Stack, Chip, Button, Divider, IconButton,
  TextField, Tooltip, alpha, useTheme, useMediaQuery, Menu, MenuItem,
  ListItemIcon, ListItemText, Select, FormControl,
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
import { getSportPreset } from "~/lib/sports";
import { googleCalendarUrl } from "~/lib/calendar";
import { COMMON_TIMEZONES } from "~/lib/timezones";
import { SPORT_PRESETS } from "~/lib/sports";
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

  // Single edit mode toggle
  const [editMode, setEditMode] = useState(false);

  // Field drafts — initialised when edit mode opens
  const [titleDraft, setTitleDraft] = useState("");
  const [locationDraft, setLocationDraft] = useState("");
  const [dateTimeDraft, setDateTimeDraft] = useState("");
  const [timezoneDraft, setTimezoneDraft] = useState("UTC");
  const [sportDraft, setSportDraft] = useState("");

  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);

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

  return (
    <Paper elevation={2} sx={{ borderRadius: 3, p: { xs: 2, sm: 3 } }}>
      <Stack spacing={2}>

        {/* ── Title row ── */}
        <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1 }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            {editMode ? (
              <TextField
                size="small"
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                inputProps={{ maxLength: 100 }}
                fullWidth
                autoFocus
                label={t("gameTitle")}
                onKeyDown={(e) => { if (e.key === "Escape") cancelEdit(); }}
              />
            ) : (
              <Typography variant="h5" fontWeight={700} sx={{ wordBreak: "break-word" }}>
                {event.title}
              </Typography>
            )}
          </Box>

          {/* Edit toggle — top-right, visible to owner/ownerless */}
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
                <IconButton size="small" onClick={openEdit} sx={{ flexShrink: 0 }}>
                  <EditIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )
          )}
        </Box>

        {/* ── Meta row: sport chip + owner inline ── */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
          {rule && (
            <Chip icon={<EventRepeatIcon />} label={describeRecurrenceRule(rule, locale)}
              size="small" color="secondary" />
          )}
          <Chip
            icon={<SportsSoccerIcon />}
            label={t(getSportPreset(sport).labelKey as any)}
            size="small"
            color="primary"
            variant="outlined"
          />
          {event.ownerName && (
            <Typography variant="caption" color="text.secondary">
              {t("managedBy", { name: "" })}
              <a href={`/users/${event.ownerId}`} style={{ textDecoration: "none", color: "inherit", fontWeight: 600 }}>
                {event.ownerName}
              </a>
            </Typography>
          )}
          {isOwner && (
            <Chip icon={<StarIcon />} label={t("ownerBadge")} size="small" color="success" variant="outlined" />
          )}
          {event.archivedAt && (
            <Chip label={t("archivedBadge")} size="small" color="warning" variant="outlined" />
          )}
          {isAuthenticated && isOwnerless && (
            <Button variant="outlined" size="small" color="secondary" onClick={onClaimOwnership}>
              {t("claimOwnership")}
            </Button>
          )}
        </Box>

        {/* ── Location & DateTime ── */}
        {editMode ? (
          <Stack spacing={1.5}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <LocationOnIcon fontSize="small" color="action" sx={{ flexShrink: 0 }} />
              <TextField
                size="small"
                value={locationDraft}
                onChange={(e) => setLocationDraft(e.target.value)}
                placeholder={t("locationPlaceholder")}
                inputProps={{ maxLength: 200 }}
                fullWidth
                label={t("location")}
              />
            </Box>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <AccessTimeIcon fontSize="small" color="action" sx={{ flexShrink: 0 }} />
              <TextField
                size="small"
                type="datetime-local"
                value={dateTimeDraft}
                onChange={(e) => setDateTimeDraft(e.target.value)}
                InputLabelProps={{ shrink: true }}
                label={t("dateTime")}
                sx={{ flex: 1 }}
              />
            </Box>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <AccessTimeIcon fontSize="small" color="action" sx={{ flexShrink: 0, opacity: 0 }} />
              <FormControl size="small" fullWidth>
                <Select
                  value={timezoneDraft}
                  onChange={(e) => setTimezoneDraft(e.target.value)}
                  displayEmpty
                >
                  {COMMON_TIMEZONES.map((tz) => (
                    <MenuItem key={tz.value} value={tz.value} sx={{ fontSize: "0.85rem" }}>
                      {tz.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Box>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <SportsSoccerIcon fontSize="small" color="action" sx={{ flexShrink: 0 }} />
              <FormControl size="small" fullWidth>
                <Select
                  value={sportDraft}
                  onChange={(e) => setSportDraft(e.target.value)}
                >
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
          <Stack spacing={0.5}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
              <LocationOnIcon fontSize="small" color="action" />
              {event.location ? (
                <Typography
                  variant="body2"
                  color="text.secondary"
                  component="a"
                  href={/^https?:\/\//i.test(event.location)
                    ? event.location
                    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.location)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  sx={{ textDecoration: "none", "&:hover": { textDecoration: "underline", color: "primary.main" } }}
                >
                  {event.location}
                </Typography>
              ) : (
                <Typography variant="body2" color="text.disabled">{t("locationOptional")}</Typography>
              )}
            </Box>
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
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
          </Stack>
        )}

        {/* ── Countdown pill ── */}
        <Box sx={{
          display: "inline-flex", alignItems: "center", gap: 1,
          px: 2, py: 0.75, borderRadius: 2, width: "fit-content",
          backgroundColor: alpha(theme.palette.primary.main, 0.08),
        }}>
          <AccessTimeIcon color="primary" fontSize="small" />
          <Typography variant="body1" fontWeight={600} color="primary">{countdown}</Typography>
        </Box>

        <Divider />

        {/* ── Quick Actions ── */}
        <Box sx={{ display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap" }}>
          <ShareBar
            title={event.title}
            dateTime={gameDate}
            location={event.location}
            maxPlayers={event.maxPlayers}
            playerCount={playerCount}
          />

          {isMobile ? (
            <>
              <NotifyButton eventId={eventId} />
              <IconButton
                onClick={(e) => setAnchorEl(e.currentTarget)}
                aria-label={t("moreActions")}
                sx={{ border: 1, borderColor: "divider" }}
              >
                <MoreVertIcon />
              </IconButton>
              <Menu anchorEl={anchorEl} open={!!anchorEl} onClose={() => setAnchorEl(null)}>
                {localMatches && localMatches.length > 0 && (
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
                {(event.eloEnabled ?? true) && (
                  <MenuItem component="a" href={`/events/${eventId}/rankings`} onClick={() => setAnchorEl(null)}>
                    <ListItemIcon><EmojiEventsIcon fontSize="small" /></ListItemIcon>
                    <ListItemText>{t("ratings")}</ListItemText>
                  </MenuItem>
                )}
                {canEditSettings && (
                  <MenuItem component="a" href={`/events/${eventId}/settings`} onClick={() => setAnchorEl(null)}>
                    <ListItemIcon><SettingsIcon fontSize="small" /></ListItemIcon>
                    <ListItemText>{t("eventSettings")}</ListItemText>
                  </MenuItem>
                )}
                <Divider sx={{ my: 0.5 }} />
                <MenuItem component="a" href={`/events/${eventId}/log`} onClick={() => setAnchorEl(null)}>
                  <ListItemIcon><AssignmentIcon fontSize="small" /></ListItemIcon>
                  <ListItemText>{t("activityLog")}</ListItemText>
                </MenuItem>
                {(gameDate <= new Date() || event.isRecurring) && (
                  <MenuItem component="a" href={`/events/${eventId}/attendance`} onClick={() => setAnchorEl(null)}>
                    <ListItemIcon><EmojiPeopleIcon fontSize="small" /></ListItemIcon>
                    <ListItemText>{t("attendance")}</ListItemText>
                  </MenuItem>
                )}
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
              </Menu>
            </>
          ) : (
            <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", alignItems: "center" }}>
              <NotifyButton eventId={eventId} />
              {localMatches && localMatches.length > 0 && <WatchScoreButton eventId={eventId} />}
              <Button variant="outlined" size="small" startIcon={<MoreVertIcon />}
                onClick={(e) => setAnchorEl(e.currentTarget)}
                aria-label={t("moreActions")}
                sx={{ flexShrink: 0 }}>
                {t("moreActions")}
              </Button>
              <Menu anchorEl={anchorEl} open={!!anchorEl} onClose={() => setAnchorEl(null)}>
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
          )}
        </Box>
      </Stack>
    </Paper>
  );
}
