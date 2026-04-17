import React, { useState, useEffect, useCallback } from "react";
import {
  Box, Typography, Stack, Chip, alpha, useTheme, Snackbar, Alert,
  CircularProgress,
} from "@mui/material";
import HowToRegIcon from "@mui/icons-material/HowToReg";
import EmojiEventsIcon from "@mui/icons-material/EmojiEvents";
import { useT } from "~/lib/useT";
import { useSession } from "~/lib/auth.client";

interface MvpCandidate {
  playerId: string;
  playerName: string;
  voteCount: number;
}

interface MvpData {
  mvp: MvpCandidate[] | null;
  isVotingOpen: boolean;
  hasVoted: boolean | null;
  totalVotes: number;
}

interface Props {
  eventId: string;
  historyId: string;
  /** All player names from the teamsSnapshot — used as vote candidates */
  participants: { id: string; name: string }[];
  compact?: boolean;
}

export function MvpVotingCard({ eventId, historyId, participants, compact }: Props) {
  const t = useT();
  const theme = useTheme();
  const { data: session } = useSession();
  const isAuthenticated = !!session?.user;
  const [data, setData] = useState<MvpData | null>(null);
  const [loading, setLoading] = useState(true);
  const [voting, setVoting] = useState(false);
  const [snack, setSnack] = useState<{ msg: string; severity: "success" | "error" } | null>(null);

  const fetchMvp = useCallback(async () => {
    try {
      const res = await fetch(`/api/events/${eventId}/history/${historyId}/mvp`);
      if (res.ok) setData(await res.json());
    } catch { /* ignore */ }
    setLoading(false);
  }, [eventId, historyId]);

  useEffect(() => { fetchMvp(); }, [fetchMvp]);

  const handleVote = async (playerId: string) => {
    setVoting(true);
    try {
      const res = await fetch(`/api/events/${eventId}/history/${historyId}/mvp-vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ votedForPlayerId: playerId }),
      });
      const body = await res.json();
      if (res.ok) {
        setSnack({ msg: t("mvpVoteSuccess"), severity: "success" });
        fetchMvp();
      } else if (res.status === 400 && body.error?.includes("yourself")) {
        setSnack({ msg: t("mvpSelfVoteError"), severity: "error" });
      } else if (res.status === 409) {
        setSnack({ msg: t("mvpAlreadyVoted"), severity: "error" });
      } else {
        setSnack({ msg: body.error || "Error", severity: "error" });
      }
    } catch {
      setSnack({ msg: "Error", severity: "error" });
    }
    setVoting(false);
  };

  if (loading) return compact ? null : <CircularProgress size={20} />;
  if (!data) return null;

  const { mvp, isVotingOpen, hasVoted } = data;
  const canVote = isVotingOpen && isAuthenticated && hasVoted === false;

  // Show MVP result badge (voting closed with votes, or already voted and results available)
  if (mvp && mvp.length > 0 && (!canVote || !isVotingOpen)) {
    return (
      <Box data-testid="mvp-result" sx={{
        display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap",
        ...(compact ? {} : { p: 1.5, borderRadius: 2, bgcolor: alpha(theme.palette.warning.main, 0.08), border: `1px solid ${alpha(theme.palette.warning.main, 0.2)}` }),
      }}>
        <EmojiEventsIcon sx={{ color: theme.palette.warning.main, fontSize: compact ? 18 : 22 }} />
        <Typography variant={compact ? "caption" : "body2"} fontWeight={700} color="warning.main">
          {t("mvpBadge")}:
        </Typography>
        {mvp.map((m) => (
          <Chip
            key={m.playerId}
            label={`${m.playerName} (${m.voteCount})`}
            size="small"
            color="warning"
            variant="outlined"
            sx={{ fontWeight: 600, fontSize: compact ? "0.7rem" : "0.8rem" }}
          />
        ))}
      </Box>
    );
  }

  // Show voting UI
  if (canVote) {
    return (
      <Box data-testid="mvp-voting" sx={{
        p: 1.5, borderRadius: 2,
        bgcolor: alpha(theme.palette.primary.main, 0.06),
        border: `1px solid ${alpha(theme.palette.primary.main, 0.2)}`,
      }}>
        <Stack spacing={1}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <HowToRegIcon sx={{ color: theme.palette.primary.main, fontSize: 20 }} />
            <Typography variant="body2" fontWeight={600}>
              {t("voteMvp")}
            </Typography>
          </Box>
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
            {participants.map((p) => (
              <Chip
                key={p.id}
                label={p.name}
                size="small"
                variant="outlined"
                color="primary"
                onClick={() => !voting && handleVote(p.id)}
                disabled={voting}
                sx={{ cursor: "pointer", fontWeight: 500 }}
              />
            ))}
          </Box>
        </Stack>
        <Snackbar open={!!snack} autoHideDuration={4000} onClose={() => setSnack(null)}>
          <Alert severity={snack?.severity} onClose={() => setSnack(null)} variant="filled">
            {snack?.msg}
          </Alert>
        </Snackbar>
      </Box>
    );
  }

  // Already voted — show who they voted for
  if (hasVoted && data.totalVotes > 0) {
    return (
      <Box data-testid="mvp-voted" sx={{
        display: "flex", alignItems: "center", gap: 1,
        ...(compact ? {} : { p: 1.5, borderRadius: 2, bgcolor: alpha(theme.palette.success.main, 0.06), border: `1px solid ${alpha(theme.palette.success.main, 0.2)}` }),
      }}>
        <EmojiEventsIcon sx={{ color: theme.palette.success.main, fontSize: compact ? 18 : 20 }} />
        <Typography variant={compact ? "caption" : "body2"} color="success.main" fontWeight={600}>
          {t("mvpAlreadyVoted")} ({data.totalVotes} {data.totalVotes === 1 ? "vote" : "votes"})
        </Typography>
      </Box>
    );
  }

  // Voting closed with no votes
  if (!isVotingOpen && !mvp) {
    return (
      <Box data-testid="mvp-closed" sx={{
        display: "flex", alignItems: "center", gap: 1,
        ...(compact ? {} : { p: 1.5, borderRadius: 2, bgcolor: alpha(theme.palette.action.hover, 0.04), border: `1px solid ${alpha(theme.palette.divider, 0.3)}` }),
      }}>
        <EmojiEventsIcon sx={{ color: theme.palette.text.disabled, fontSize: compact ? 16 : 20 }} />
        <Typography variant="caption" color="text.disabled">
          {t("mvpNoVotesYet")}
        </Typography>
      </Box>
    );
  }

  return null;
}
