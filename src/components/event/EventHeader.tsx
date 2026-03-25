import React, { useState } from "react";
import {
  Paper, Typography, Box, Stack, Chip, Button, Divider, IconButton,
  TextField, Tooltip, alpha, useTheme,
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
import { useT } from "~/lib/useT";
import { detectLocale } from "~/lib/i18n";
import { describeRecurrenceRule, parseRecurrenceRule } from "~/lib/recurrence";
import { getSportPreset } from "~/lib/sports";
import type { EventData } from "./types";
import type { Imatch } from "~/lib/random";
import { ShareBar } from "./ShareBar";
import { NotifyButton } from "./NotifyButton";
import { WatchScoreButton } from "./WatchScoreButton";
import { MoreActionsMenu } from "./MoreActionsMenu";

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
  onClaimOwnership: () => Promise<void>;
  onSnackbar: (msg: string) => void;
}

export function EventHeader({
  eventId, event, sport, gameDate, countdown, canEditSettings,
  isOwner, isAuthenticated, isOwnerless, localMatches,
  onSaveTitle, onSaveLocation, onClaimOwnership,
}: Props) {
  const t = useT();
  const locale = detectLocale();
  const theme = useTheme();
  const rule = parseRecurrenceRule(event.recurrenceRule);

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [editingLocation, setEditingLocation] = useState(false);
  const [locationDraft, setLocationDraft] = useState("");

  const handleSaveTitle = async () => {
    const trimmed = titleDraft.trim();
    if (!trimmed) return;
    setEditingTitle(false);
    await onSaveTitle(trimmed);
  };

  const handleSaveLocation = async () => {
    setEditingLocation(false);
    await onSaveLocation(locationDraft);
  };

  return (
    <Paper elevation={2} sx={{ borderRadius: 3, p: { xs: 2, sm: 3 } }}>
      <Stack spacing={2}>
        <Box>
          {editingTitle && canEditSettings ? (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <TextField
                size="small"
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                inputProps={{ maxLength: 100 }}
                sx={{ flex: 1 }}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSaveTitle();
                  if (e.key === "Escape") setEditingTitle(false);
                }}
              />
              <IconButton size="small" onClick={handleSaveTitle} color="primary">
                <CheckIcon fontSize="small" />
              </IconButton>
              <IconButton size="small" onClick={() => setEditingTitle(false)}>
                <CloseIcon fontSize="small" />
              </IconButton>
            </Box>
          ) : (
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
              <Typography variant="h4" fontWeight={700}>{event.title}</Typography>
              {canEditSettings && (
                <IconButton size="small" onClick={() => { setTitleDraft(event.title); setEditingTitle(true); }}>
                  <EditIcon sx={{ fontSize: 18 }} />
                </IconButton>
              )}
            </Box>
          )}
          <Stack direction="row" spacing={0.5} sx={{ mt: 0.5, flexWrap: "wrap", alignItems: "center" }}>
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
              <Typography variant="body2" color="text.secondary" sx={{ ml: 0.5 }}>
                {t("managedBy", { name: "" })}
                <a href={`/users/${event.ownerId}`} style={{ textDecoration: "none", color: "inherit", fontWeight: 600 }}>
                  {event.ownerName}
                </a>
              </Typography>
            )}
          </Stack>
        </Box>

        <Stack direction="row" spacing={2} flexWrap="wrap">
          {editingLocation && canEditSettings ? (
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, flex: 1 }}>
              <LocationOnIcon fontSize="small" color="action" />
              <TextField
                size="small"
                value={locationDraft}
                onChange={(e) => setLocationDraft(e.target.value)}
                placeholder={t("locationPlaceholder")}
                inputProps={{ maxLength: 200 }}
                sx={{ flex: 1 }}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSaveLocation();
                  if (e.key === "Escape") setEditingLocation(false);
                }}
              />
              <IconButton size="small" onClick={handleSaveLocation} color="primary">
                <CheckIcon fontSize="small" />
              </IconButton>
              <IconButton size="small" onClick={() => setEditingLocation(false)}>
                <CloseIcon fontSize="small" />
              </IconButton>
            </Box>
          ) : (
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
              <LocationOnIcon fontSize="small" color="action" />
              {event.location ? (
                <Typography
                  variant="body2"
                  color="text.secondary"
                  component="a"
                  href={/^https?:\/\//i.test(event.location) ? event.location : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.location)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  sx={{ textDecoration: "none", "&:hover": { textDecoration: "underline", color: "primary.main" } }}
                >
                  {event.location}
                </Typography>
              ) : (
                <Typography variant="body2" color="text.disabled">
                  {t("locationOptional")}
                </Typography>
              )}
              {canEditSettings && (
                <Tooltip title={t("editLocation")}>
                  <IconButton size="small" onClick={() => { setLocationDraft(event.location || ""); setEditingLocation(true); }}>
                    <EditIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                </Tooltip>
              )}
            </Box>
          )}
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
            <AccessTimeIcon fontSize="small" color="action" />
            <Typography variant="body2" color="text.secondary">
              {gameDate.toLocaleString(locale === "pt" ? "pt-PT" : "en-GB", {
                weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
              })}
            </Typography>
          </Box>
        </Stack>

        <Box sx={{
          display: "inline-flex", alignItems: "center", gap: 1,
          px: 2, py: 1, borderRadius: 2, width: "fit-content",
          backgroundColor: alpha(theme.palette.primary.main, 0.08),
        }}>
          <AccessTimeIcon color="primary" fontSize="small" />
          <Typography variant="body1" fontWeight={600} color="primary">{countdown}</Typography>
        </Box>

        <Divider />

        {/* ── Quick Actions — always visible ── */}
        <Stack spacing={1}>
          <ShareBar title={event.title} />
          <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", alignItems: "center" }}>
            {/* Primary actions — always visible */}
            {(gameDate <= new Date() || event.isRecurring) && (
              <Button variant="outlined" size="small" startIcon={<HistoryIcon />}
                href={`/events/${eventId}/history`} sx={{ flexShrink: 0 }}>
                {t("history")}
              </Button>
            )}
            {(event.eloEnabled ?? true) && (
              <Button variant="outlined" size="small" startIcon={<EmojiEventsIcon />}
                href={`/events/${eventId}/rankings`} sx={{ flexShrink: 0 }}>
                {t("ratings")}
              </Button>
            )}
            {canEditSettings && (
              <Button variant="outlined" size="small" startIcon={<SettingsIcon />}
                href={`/events/${eventId}/settings`} sx={{ flexShrink: 0 }}>
                {t("eventSettings")}
              </Button>
            )}
            <NotifyButton eventId={eventId} />
            {localMatches && localMatches.length > 0 && (
              <WatchScoreButton eventId={eventId} />
            )}

            {/* Secondary actions — "More" menu */}
            <MoreActionsMenu eventId={eventId} event={event} gameDate={gameDate} />

            {/* Owner badge — always visible for owners */}
            {isOwner && (
              <Chip icon={<StarIcon />} label={t("ownerBadge")} size="small" color="success" variant="outlined" />
            )}
            {/* Archived badge */}
            {event.archivedAt && (
              <Chip label={t("archivedBadge")} size="small" color="warning" variant="outlined" />
            )}
            {/* Claim ownership for authenticated users on ownerless events */}
            {isAuthenticated && isOwnerless && (
              <Button variant="outlined" size="small" color="secondary" onClick={onClaimOwnership}>
                {t("claimOwnership")}
              </Button>
            )}
          </Box>
        </Stack>

      </Stack>
    </Paper>
  );
}
