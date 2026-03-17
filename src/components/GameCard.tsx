import React from "react";
import { Paper, Typography, Stack, Box, Chip } from "@mui/material";
import LocationOnIcon from "@mui/icons-material/LocationOn";
import AccessTimeIcon from "@mui/icons-material/AccessTime";
import { detectLocale } from "~/lib/i18n";

export interface GameSummary {
  id: string;
  title: string;
  location: string;
  dateTime: string;
  sport: string;
  maxPlayers: number;
  playerCount: number;
}

export function GameCard({ game, dimPast = false }: { game: GameSummary; dimPast?: boolean }) {
  const locale = detectLocale();
  const date = new Date(game.dateTime);
  const isPast = dimPast && date < new Date();
  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, opacity: isPast ? 0.7 : 1 }}>
      <Stack spacing={1}>
        <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Typography variant="subtitle1" fontWeight={600}>
            <a href={`/events/${game.id}`} style={{ textDecoration: "none", color: "inherit" }}>
              {game.title}
            </a>
          </Typography>
          <Chip
            label={`${game.playerCount}/${game.maxPlayers}`}
            size="small"
            color={game.playerCount >= game.maxPlayers ? "warning" : "primary"}
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
                weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
              })}
            </Typography>
          </Box>
        </Stack>
      </Stack>
    </Paper>
  );
}
