import { Box, Stack, Typography, Chip, alpha, useTheme } from "@mui/material";
import SportsSoccerIcon from "@mui/icons-material/SportsSoccer";
import { useT } from "~/lib/useT";

/** One goal in a game's timeline, as shipped by the history list endpoint. */
export interface MatchEventSummary {
  id: string;
  type: string;
  team: string;
  minute: number | null;
  ownGoal: boolean;
  penalty: boolean;
  scorerName: string;
  assistName: string | null;
}

/**
 * Read-only goal timeline for a settled game (ADR 0039).
 *
 * Renders nothing when the game has no goals, so past games that predate the
 * feature — or that nobody annotated — stay visually unchanged.
 */
export function MatchEventsTimeline({ events }: { events?: MatchEventSummary[] | null }) {
  const t = useT();
  const theme = useTheme();
  const goals = (events ?? []).filter((e) => e.type === "goal");
  if (goals.length === 0) return null;

  return (
    <Box
      data-testid="match-events-timeline"
      sx={{
        borderRadius: 3,
        p: 2,
        backgroundColor: alpha(theme.palette.action.hover, 0.04),
        border: `1px solid ${alpha(theme.palette.divider, 0.08)}`,
      }}
    >
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
        <SportsSoccerIcon fontSize="small" sx={{ color: "text.secondary" }} />
        <Typography variant="subtitle2" fontWeight={700}>
          {t("matchEventsTitle")}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {t("matchEventsCount", { count: goals.length })}
        </Typography>
      </Stack>

      <Stack spacing={1}>
        {goals.map((goal) => (
          <Stack key={goal.id} direction="row" spacing={1} alignItems="center">
            <Typography
              variant="caption"
              color="text.disabled"
              sx={{ width: 34, flexShrink: 0, fontVariantNumeric: "tabular-nums" }}
            >
              {goal.minute !== null ? t("matchEventsMinute", { minute: goal.minute }) : "—"}
            </Typography>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {goal.scorerName}
            </Typography>
            {goal.ownGoal && (
              <Chip label={t("matchEventsOwnGoal")} size="small" color="warning" variant="outlined" sx={{ borderRadius: 2 }} />
            )}
            {goal.penalty && (
              <Chip label={t("matchEventsPenalty")} size="small" variant="outlined" sx={{ borderRadius: 2 }} />
            )}
            {goal.assistName && (
              <Typography variant="caption" color="text.secondary">
                {t("matchEventsAssistBy", { name: goal.assistName })}
              </Typography>
            )}
          </Stack>
        ))}
      </Stack>
    </Box>
  );
}
