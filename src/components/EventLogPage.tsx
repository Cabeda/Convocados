import React, { useState, useEffect, useCallback } from "react";
import {
  Container, Paper, Typography, Box, Stack, Button,
  CircularProgress, Alert, Chip, useTheme,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import HistoryIcon from "@mui/icons-material/History";
import PersonAddIcon from "@mui/icons-material/PersonAdd";
import PersonRemoveIcon from "@mui/icons-material/PersonRemove";
import ShuffleIcon from "@mui/icons-material/Shuffle";
import SettingsIcon from "@mui/icons-material/Settings";
import PaymentIcon from "@mui/icons-material/Payment";
import ArchiveIcon from "@mui/icons-material/Archive";
import UnarchiveIcon from "@mui/icons-material/Unarchive";
import ScoreboardIcon from "@mui/icons-material/Scoreboard";
import SportsIcon from "@mui/icons-material/Sports";
import EmojiEventsIcon from "@mui/icons-material/EmojiEvents";
import TuneIcon from "@mui/icons-material/Tune";
import { ThemeModeProvider } from "./ThemeModeProvider";
import { ResponsiveLayout } from "./ResponsiveLayout";
import { useT } from "~/lib/useT";
import { useSession } from "~/lib/auth.client";

interface LogEntry {
  id: string;
  action: string;
  actor: string | null;
  actorId: string | null;
  details: Record<string, unknown>;
  createdAt: string;
}

const ACTION_COLORS: Record<string, "success" | "error" | "info" | "warning" | "default"> = {
  player_added: "success",
  player_removed: "error",
  player_claimed: "info",
  player_unclaimed: "warning",
  teams_randomized: "info",
  teams_edited: "info",
  team_names_changed: "info",
  player_order_changed: "info",
  player_order_reset: "info",
  event_updated: "info",
  ownership_claimed: "warning",
  ownership_relinquished: "warning",
  ownership_transferred: "warning",
  cost_set: "info",
  cost_removed: "error",
  payment_updated: "info",
  recurrence_reset: "warning",
  event_archived: "warning",
  event_unarchived: "info",
  history_score_updated: "info",
  history_teams_updated: "info",
  history_status_updated: "warning",
  history_payments_updated: "info",
  history_unlocked: "warning",
  history_locked: "info",
  rating_initial_set: "info",
  rating_recalculated: "info",
  rating_manual_enabled: "warning",
  rating_manual_disabled: "warning",
};

const ACTION_ICONS: Record<string, React.ReactNode> = {
  player_added: <PersonAddIcon fontSize="small" />,
  player_removed: <PersonRemoveIcon fontSize="small" />,
  teams_randomized: <ShuffleIcon fontSize="small" />,
  event_updated: <SettingsIcon fontSize="small" />,
  cost_set: <PaymentIcon fontSize="small" />,
  payment_updated: <PaymentIcon fontSize="small" />,
  event_archived: <ArchiveIcon fontSize="small" />,
  event_unarchived: <UnarchiveIcon fontSize="small" />,
  history_score_updated: <ScoreboardIcon fontSize="small" />,
  history_teams_updated: <SportsIcon fontSize="small" />,
  history_status_updated: <HistoryIcon fontSize="small" />,
  history_payments_updated: <PaymentIcon fontSize="small" />,
  history_unlocked: <HistoryIcon fontSize="small" />,
  history_locked: <HistoryIcon fontSize="small" />,
  rating_initial_set: <EmojiEventsIcon fontSize="small" />,
  rating_recalculated: <EmojiEventsIcon fontSize="small" />,
  rating_manual_enabled: <TuneIcon fontSize="small" />,
  rating_manual_disabled: <TuneIcon fontSize="small" />,
};

const ACTION_I18N: Record<string, string> = {
  player_added: "logPlayerAdded",
  player_removed: "logPlayerRemoved",
  player_claimed: "logPlayerClaimed",
  teams_randomized: "logTeamsRandomized",
  teams_edited: "logTeamsEdited",
  team_names_changed: "logTeamNamesChanged",
  player_order_changed: "logPlayerOrderChanged",
  player_order_reset: "logPlayerOrderReset",
  event_updated: "logEventUpdated",
  ownership_claimed: "logOwnershipClaimed",
  ownership_relinquished: "logOwnershipRelinquished",
  ownership_transferred: "logOwnershipTransferred",
  cost_set: "logCostSet",
  cost_removed: "logCostRemoved",
  payment_updated: "logPaymentUpdated",
  recurrence_reset: "logRecurrenceReset",
  event_archived: "logEventArchived",
  event_unarchived: "logEventUnarchived",
  history_score_updated: "logHistoryScoreUpdated",
  history_teams_updated: "logHistoryTeamsUpdated",
  history_status_updated: "logHistoryStatusUpdated",
  history_payments_updated: "logHistoryPaymentsUpdated",
  history_unlocked: "logHistoryUnlocked",
  history_locked: "logHistoryLocked",
  rating_initial_set: "logRatingInitialSet",
  rating_recalculated: "logRatingRecalculated",
  rating_manual_enabled: "logRatingManualEnabled",
  rating_manual_disabled: "logRatingManualDisabled",
};

function LogEntryRow({ entry, currentUserId }: { entry: LogEntry; currentUserId?: string }) {
  const t = useT();
  const theme = useTheme();
  const color = ACTION_COLORS[entry.action] ?? "default";
  const icon = ACTION_ICONS[entry.action] ?? <HistoryIcon fontSize="small" />;
  const i18nKey = ACTION_I18N[entry.action];

  const actor = entry.actor ?? t("logAnonymous");
  const player = (entry.details.playerName as string) ?? "";
  const actorIsCurrentUser = !!(currentUserId && entry.actorId && entry.actorId === currentUserId);

  // Build description with actor name as a link when it's the current user
  let descriptionNode: React.ReactNode;
  if (i18nKey) {
    const ACTOR_PLACEHOLDER = "\x00ACTOR\x00";
    const raw = t(i18nKey as any, { actor: ACTOR_PLACEHOLDER, player });
    const parts = raw.split(ACTOR_PLACEHOLDER);

    const actorNode = actorIsCurrentUser ? (
      <a href={`/users/${entry.actorId}`} style={{ textDecoration: "none", color: "inherit", fontWeight: 600 }}>
        {actor}
      </a>
    ) : actor;

    descriptionNode = (
      <>
        {parts[0]}
        {actorNode}
        {parts[1] ?? ""}
      </>
    );
  } else {
    descriptionNode = entry.action.replace(/_/g, " ");
  }

  const timeAgo = formatRelativeTime(entry.createdAt);

  const chipColor = color === "default" ? undefined : color;

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 1.5,
        borderRadius: 2,
        borderLeft: 4,
        borderLeftColor: color !== "default" ? `${color}.main` : "divider",
      }}
    >
      <Stack direction="row" spacing={1.5} alignItems="flex-start">
        <Box sx={{ color: color !== "default" ? `${color}.main` : "text.secondary", mt: 0.25 }}>
          {icon}
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2">{descriptionNode}</Typography>
          <Typography variant="caption" color="text.secondary">{timeAgo}</Typography>
        </Box>
        {chipColor && (
          <Chip
            label={entry.action.replace(/_/g, " ")}
            size="small"
            color={chipColor}
            variant="outlined"
            sx={{ fontSize: "0.65rem", height: 20 }}
          />
        )}
      </Stack>
    </Paper>
  );
}

function formatRelativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diff = now - then;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function EventLogPage({ eventId }: { eventId: string }) {
  const t = useT();
  const { data: session } = useSession();
  const currentUserId = session?.user?.id;
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const fetchLogs = useCallback(async (cursor?: string | null) => {
    const params = new URLSearchParams();
    if (cursor) params.set("cursor", cursor);
    const res = await fetch(`/api/events/${eventId}/log?${params.toString()}`);
    if (!res.ok) throw new Error("Not found");
    return res.json();
  }, [eventId]);

  useEffect(() => {
    fetchLogs()
      .then((data) => {
        setEntries(data.entries);
        setHasMore(data.hasMore);
        setNextCursor(data.nextCursor);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [fetchLogs]);

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const data = await fetchLogs(nextCursor);
      setEntries((prev) => [...prev, ...data.entries]);
      setHasMore(data.hasMore);
      setNextCursor(data.nextCursor);
    } catch {}
    setLoadingMore(false);
  };

  return (
    <ThemeModeProvider>
      <ResponsiveLayout>
        <Container maxWidth="md" sx={{ py: 4 }}>
          <Stack spacing={3}>
            <Stack direction="row" alignItems="center" spacing={1}>
              <Button href={`/events/${eventId}`} startIcon={<ArrowBackIcon />} size="small">
                {t("backToGame")}
              </Button>
            </Stack>

            <Stack direction="row" alignItems="center" spacing={1}>
              <HistoryIcon color="primary" />
              <Typography variant="h5" fontWeight={700}>{t("activityLogTitle")}</Typography>
            </Stack>
            <Typography variant="body2" color="text.secondary">{t("activityLogDesc")}</Typography>

            {loading && (
              <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
                <CircularProgress />
              </Box>
            )}

            {error && <Alert severity="error">{t("gameNotFound")}</Alert>}

            {!loading && !error && entries.length === 0 && (
              <Alert severity="info">{t("noActivityLog")}</Alert>
            )}

            {entries.length > 0 && (
              <Stack spacing={1}>
                {entries.map((e) => (
                  <LogEntryRow key={e.id} entry={e} currentUserId={currentUserId} />
                ))}
                {hasMore && (
                  <Box sx={{ display: "flex", justifyContent: "center", pt: 1 }}>
                    <Button variant="outlined" size="small" onClick={loadMore} disabled={loadingMore}>
                      {loadingMore ? t("loading") : t("loadMore")}
                    </Button>
                  </Box>
                )}
              </Stack>
            )}
          </Stack>
        </Container>
      </ResponsiveLayout>
    </ThemeModeProvider>
  );
}
