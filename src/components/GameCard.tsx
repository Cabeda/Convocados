import React from "react";
import { Paper, Typography, Stack, Box, Chip } from "@mui/material";
import LocationOnIcon from "@mui/icons-material/LocationOn";
import AccessTimeIcon from "@mui/icons-material/AccessTime";
import { detectLocale } from "~/lib/i18n";
import { useT } from "~/lib/useT";
import { formatDateInTz } from "~/lib/timezones";

export interface GameSummary {
  id: string;
  title: string;
  location: string;
  dateTime: string;
  timezone?: string;
  sport: string;
  maxPlayers: number;
  playerCount: number;
  archivedAt?: string | null;
}

export function GameCard({ game, dimPast = false }: { game: GameSummary; dimPast?: boolean }) {
  const locale = detectLocale();
  const t = useT();
  const date = new Date(game.dateTime);
  const isPast = dimPast && date < new Date();
  const isArchived = !!game.archivedAt;
  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, opacity: isPast || isArchived ? 0.7 : 1 }}>
      <Stack spacing={1}>
        <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Typography variant="subtitle1" fontWeight={600}>
            <a href={`/events/${game.id}`} style={{ textDecoration: "none", color: "inherit" }}>
              {game.title}
            </a>
          </Typography>
          <Box sx={{ display: "flex", gap: 0.5, alignItems: "center" }}>
            {isArchived && (
              <Chip label={t("archivedBadge")} size="small" color="warning" variant="outlined" />
            )}
            <Chip
              label={`${game.playerCount}/${game.maxPlayers}`}
              size="small"
              color={game.playerCount >= game.maxPlayers ? "warning" : "primary"}
            />
          </Box>
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
              {formatDateInTz(date, locale === "pt" ? "pt-PT" : "en-GB", game.timezone || "UTC", {
                weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
              })}
            </Typography>
          </Box>
        </Stack>
      </Stack>
    </Paper>
  );
}
