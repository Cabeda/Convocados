import React, { useState } from "react";
import {
  Paper, Typography, Box, Stack, Chip, Button, alpha, useTheme,
} from "@mui/material";
import PersonAddIcon from "@mui/icons-material/PersonAdd";
import EmojiPeopleIcon from "@mui/icons-material/EmojiPeople";
import AirlineSeatReclineNormalIcon from "@mui/icons-material/AirlineSeatReclineNormal";
import { useT } from "~/lib/useT";
import type { Player } from "./types";

interface Props {
  userName: string;
  players: Player[];
  maxPlayers: number;
  onJoin: (name: string, linkToAccount?: boolean) => Promise<void>;
  onLeave: (id: string) => Promise<void>;
}

export function QuickJoin({ userName, players, maxPlayers, onJoin, onLeave }: Props) {
  const t = useT();
  const theme = useTheme();
  const [joining, setJoining] = useState(false);

  const joined = players.find((p) => p.name.toLowerCase() === userName.toLowerCase());
  const isOnBench = joined ? players.indexOf(joined) >= maxPlayers : false;

  const handleJoin = async () => {
    setJoining(true);
    await onJoin(userName, true);
    setJoining(false);
  };

  const handleLeave = async () => {
    if (!joined) return;
    setJoining(true);
    await onLeave(joined.id);
    setJoining(false);
  };

  return (
    <Paper elevation={3} sx={{
      borderRadius: 3, p: { xs: 2, sm: 3 },
      background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.08)}, ${alpha(theme.palette.secondary.main, 0.06)})`,
      border: `1px solid ${alpha(theme.palette.primary.main, 0.2)}`,
    }}>
      <Stack spacing={2}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <EmojiPeopleIcon color="primary" />
          <Typography variant="h6" fontWeight={700}>{t("quickJoinTitle")}</Typography>
        </Box>

        {joined ? (
          <Box sx={{ display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap" }}>
            <Chip
              icon={isOnBench ? <AirlineSeatReclineNormalIcon /> : undefined}
              label={isOnBench ? t("youAreOnBench") : t("youArePlaying", { name: joined.name })}
              color={isOnBench ? "warning" : "success"}
              variant="filled"
            />
            <Button size="small" variant="outlined" color="error" onClick={handleLeave} disabled={joining}>
              {t("quickJoinLeave")}
            </Button>
          </Box>
        ) : (
          <Button
            variant="contained"
            onClick={handleJoin}
            disabled={joining}
            startIcon={<PersonAddIcon />}
          >
            {t("quickJoinBtn")} ({userName})
          </Button>
        )}
      </Stack>
    </Paper>
  );
}
