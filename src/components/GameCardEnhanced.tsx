import React, { useState } from "react";
import {
  Paper,
  Typography,
  Stack,
  Box,
  Chip,
  LinearProgress,
  Button,
  IconButton,
  Tooltip,
  useTheme,
  useMediaQuery,
} from "@mui/material";
import LocationOnIcon from "@mui/icons-material/LocationOn";
import AccessTimeIcon from "@mui/icons-material/AccessTime";
import WhatsAppIcon from "@mui/icons-material/WhatsApp";
import AddIcon from "@mui/icons-material/Add";
import RemoveIcon from "@mui/icons-material/Remove";
import ShareIcon from "@mui/icons-material/Share";
import { detectLocale } from "~/lib/i18n";
import { useT } from "~/lib/useT";
import { formatWhatsAppMessage, getWhatsAppUrl, isMobileDevice, type WhatsAppMessageData } from "~/lib/whatsapp";

export interface GameSummary {
  id: string;
  title: string;
  location: string;
  dateTime: string;
  sport: string;
  maxPlayers: number;
  playerCount: number;
  archivedAt?: string | null;
  userJoined?: boolean;
  onJoin?: () => void;
  onLeave?: () => void;
}

function getTimeRemaining(date: Date): { text: string; urgent: boolean } {
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();

  if (diffMs < 0) {
    return { text: "Past", urgent: false };
  }

  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 1) {
    return { text: `In ${diffDays} days`, urgent: false };
  }

  if (diffDays === 1) {
    const hours = diffHours %24;
    const dateStr = date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    return { text: `Tomorrow at ${dateStr}`, urgent: false };
  }

  if (diffHours > 0) {
    return { text: `In ${diffHours}h ${diffMins % 60}m`, urgent: diffHours < 3 };
  }

  if (diffMins > 0) {
    return { text: `In ${diffMins}m`, urgent: true };
  }

  return { text: "Now", urgent: true };
}

function getSpotStatus(playerCount: number, maxPlayers: number): {
  progress: number;
  color: "success" | "warning" | "error";
} {
  const progress = (playerCount / maxPlayers) * 100;

  if (playerCount >= maxPlayers) {
    return { progress: 100, color: "error" };
  }

  if (playerCount >= maxPlayers * 0.8) {
    return { progress, color: "warning" };
  }

  return { progress, color: "success" };
}

export function GameCard({ game, dimPast = false }: { game: GameSummary; dimPast?: boolean }) {
  const locale = detectLocale();
  const t = useT();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const date = new Date(game.dateTime);
  const isPast = dimPast && date < new Date();
  const isArchived = !!game.archivedAt;

  const [isJoining, setIsJoining] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);

  const timeRemaining = getTimeRemaining(date);
  const spotStatus = getSpotStatus(game.playerCount, game.maxPlayers);
  const spotsLeft = game.maxPlayers - game.playerCount;

  const handleWhatsAppShare = () => {
    const messageData: WhatsAppMessageData = {
      title: game.title,
      date,
      location: game.location,
      spotsLeft,
      maxPlayers: game.maxPlayers,
      eventUrl: `${typeof window !== "undefined" ? window.location.origin : ""}/events/${game.id}`,
    };

    const message = formatWhatsAppMessage(messageData, t);
    const url = getWhatsAppUrl(message, isMobileDevice());
    window.open(url, "_blank");
  };

  const handleJoin = async () => {
    if (!game.onJoin) return;
    setIsJoining(true);
    try {
      await game.onJoin();
    } finally {
      setIsJoining(false);
    }
  };

  const handleLeave = async () => {
    if (!game.onLeave) return;
    setIsLeaving(true);
    try {
      await game.onLeave();
    } finally {
      setIsLeaving(false);
    }
  };

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2,
        borderRadius: 2,
        opacity: isPast || isArchived ? 0.7 : 1,
        transition: "transform 0.15s, box-shadow 0.15s",
        "&:hover": {
          transform: "translateY(-2px)",
          boxShadow: 2,
        },
      }}
    >
      <Stack spacing={1.5}>
        <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <Box sx={{ flex: 1 }}>
            <Typography variant="subtitle1" fontWeight={600}>
              <a href={`/events/${game.id}`} style={{ textDecoration: "none", color: "inherit" }}>
                {game.title}
              </a>
            </Typography>
            {!isPast && !isArchived && timeRemaining.urgent && (
              <Typography variant="caption" color="error.main" sx={{ fontWeight: 600 }}>
                {timeRemaining.text}
              </Typography>
            )}
          </Box>

          <Box sx={{ display: "flex", gap: 0.5, alignItems: "center" }}>
            {isArchived && (
              <Chip label={t("archivedBadge")} size="small" color="warning" variant="outlined" />
            )}
          </Box>
        </Box>

        <Box>
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb:0.5 }}>
            <Typography variant="body2" color="text.secondary">
              {game.playerCount}/{game.maxPlayers} {t("players")}
            </Typography>
            {spotsLeft > 0 && !isArchived && (
              <Chip
                label={t("spotsLeft", { n: spotsLeft })}
                size="small"
                color={spotStatus.color}
                variant="outlined"
              />
            )}
          </Box>
          <LinearProgress
            variant="determinate"
            value={spotStatus.progress}
            color={spotStatus.color}
            sx={{ borderRadius: 1, height: 6 }}
          />
        </Box>

        <Stack direction="row" spacing={2} sx={{ flexWrap: "wrap" }}>
          {game.location && (
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
              <LocationOnIcon fontSize="small" color="action" />
              <Typography variant="body2" color="text.secondary">{game.location}</Typography>
            </Box>
          )}
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
            <AccessTimeIcon fontSize="small" color="action" />
            <Typography variant="body2" color="text.secondary">
              {date.toLocaleString(locale === "pt" ? "pt-PT" : "en-GB", {
                weekday: "short",
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </Typography>
          </Box>
        </Stack>

        {game.userJoined !== undefined && !isPast && !isArchived && (
          <Box sx={{ display: "flex", gap: 1, mt: 1 }}>
            {game.userJoined ? (
              <Button
                size="small"
                variant="outlined"
                color="error"
                startIcon={<RemoveIcon />}
                onClick={handleLeave}
                disabled={isLeaving}
                fullWidth
              >
                {t("quickJoinLeave")}
              </Button>
            ) : (
              <Button
                size="small"
                variant="contained"
                color="primary"
                startIcon={<AddIcon />}
                onClick={handleJoin}
                disabled={isJoining || game.playerCount >= game.maxPlayers}
                fullWidth
              >
                {t("quickJoinBtn")}
              </Button>
            )}
            <Tooltip title={t("shareGame")}>
              <IconButton
                size="small"
                onClick={handleWhatsAppShare}
                sx={{ minWidth: 48, minHeight: 48 }}
              >
                <WhatsAppIcon />
              </IconButton>
            </Tooltip>
          </Box>
        )}

        {game.userJoined === undefined && !isPast && !isArchived && (
          <Tooltip title={t("shareGame")}>
            <IconButton
              size="small"
              onClick={handleWhatsAppShare}
              aria-label={t("shareGame")}
            >
              <WhatsAppIcon />
            </IconButton>
          </Tooltip>
        )}
      </Stack>
    </Paper>
  );
}