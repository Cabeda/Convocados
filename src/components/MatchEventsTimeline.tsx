import { useState } from "react";
import {
  Box, Stack, Typography, Chip, Button, IconButton, Tooltip,
  MenuItem, TextField, Dialog, DialogTitle, DialogContent, DialogActions,
  Alert, alpha, useTheme,
} from "@mui/material";
import SportsSoccerIcon from "@mui/icons-material/SportsSoccer";
import AddCircleIcon from "@mui/icons-material/AddCircle";
import DeleteIcon from "@mui/icons-material/Delete";
import { useT } from "~/lib/useT";

/** One goal in a game's timeline, as shipped by the history endpoints. */
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

/** A player eligible to be credited with a goal. */
export interface MatchEventPlayerOption {
  id: string;
  name: string;
}

interface MatchEventsTimelineProps {
  events?: MatchEventSummary[] | null;
  /** The two sides, so the scorer list can be scoped to the right team. */
  teams?: { name: string; players: string[] }[];
  /** Omit to render read-only (e.g. for a viewer who cannot edit). */
  onAdd?: (draft: { scorerName: string; assistName: string | null; team: string; minute: number | null; ownGoal: boolean; penalty: boolean }) => Promise<void> | void;
  onRemove?: (id: string) => Promise<void> | void;
  canEdit?: boolean;
  saving?: boolean;
  /** Shown when editing but there are no players to pick from. */
  emptyPlayersHint?: string;
}

/**
 * Goal timeline for a settled game (ADR 0039).
 *
 * Renders nothing when the game has no goals and the viewer cannot edit — so
 * past games that predate the feature stay visually unchanged. With edit rights
 * it always renders, exposing the "Add goal" affordance.
 */
export function MatchEventsTimeline({
  events,
  teams,
  onAdd,
  onRemove,
  canEdit = false,
  saving = false,
  emptyPlayersHint,
}: MatchEventsTimelineProps) {
  const t = useT();
  const theme = useTheme();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const goals = (events ?? []).filter((e) => e.type === "goal");
  const canWrite = canEdit && !!onAdd;

  // Read-only viewers see nothing when there is nothing to show.
  if (goals.length === 0 && !canWrite) return null;

  const teamNames = (teams ?? []).map((tm) => tm.name);

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
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: goals.length ? 1.5 : 0 }}>
        <SportsSoccerIcon fontSize="small" sx={{ color: "text.secondary" }} />
        <Typography variant="subtitle2" fontWeight={700}>
          {t("matchEventsTitle")}
        </Typography>
        {goals.length > 0 && (
          <Typography variant="caption" color="text.secondary">
            {t("matchEventsCount", { count: goals.length })}
          </Typography>
        )}
        {canWrite && (
          <Button
            size="small"
            startIcon={<AddCircleIcon />}
            onClick={() => { setError(null); setDialogOpen(true); }}
            disabled={saving}
            sx={{ ml: "auto", borderRadius: 2, textTransform: "none" }}
          >
            {t("matchEventsAddGoal")}
          </Button>
        )}
      </Stack>

      {goals.length === 0 && canWrite && (
        <Typography variant="body2" color="text.disabled">
          {t("matchEventsEmpty")}
        </Typography>
      )}

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
            {canWrite && onRemove && (
              <Tooltip title={t("matchEventsRemoveGoal")}>
                <IconButton
                  size="small"
                  disabled={saving}
                  onClick={() => { void onRemove(goal.id); }}
                  sx={{ ml: "auto" }}
                >
                  <DeleteIcon fontSize="inherit" />
                </IconButton>
              </Tooltip>
            )}
          </Stack>
        ))}
      </Stack>

      {dialogOpen && (
        <AddGoalDialog
          teams={teams ?? []}
          saving={saving}
          error={error}
          emptyPlayersHint={emptyPlayersHint}
          onClose={() => setDialogOpen(false)}
          onSubmit={async (draft) => {
            try {
              await onAdd?.(draft);
              setDialogOpen(false);
            } catch (e) {
              setError(e instanceof Error ? e.message : t("matchEventsAddError"));
            }
          }}
          teamNames={teamNames}
        />
      )}
    </Box>
  );
}

interface AddGoalDialogProps {
  teams: { name: string; players: string[] }[];
  teamNames: string[];
  saving: boolean;
  error: string | null;
  emptyPlayersHint?: string;
  onClose: () => void;
  onSubmit: (draft: { scorerName: string; assistName: string | null; team: string; minute: number | null; ownGoal: boolean; penalty: boolean }) => void;
}

function AddGoalDialog({ teams, teamNames, saving, error, emptyPlayersHint, onClose, onSubmit }: AddGoalDialogProps) {
  const t = useT();
  // The API speaks in sides ("one"/"two"); the UI shows the team names.
  const [teamIndex, setTeamIndex] = useState(0);
  const [scorerName, setScorerName] = useState("");
  const [assistName, setAssistName] = useState("");
  const [minute, setMinute] = useState("");
  const [ownGoal, setOwnGoal] = useState(false);
  const [penalty, setPenalty] = useState(false);

  // Own goals credit the opposing side, so the scorer is picked from the
  // opponent's roster.
  const rosterTeamIndex = ownGoal ? (teamIndex === 0 ? 1 : 0) : teamIndex;
  const roster = teams[rosterTeamIndex]?.players ?? [];

  const submit = () => {
    if (!scorerName) return;
    onSubmit({
      scorerName,
      assistName: ownGoal ? null : (assistName || null),
      team: teamIndex === 0 ? "one" : "two",
      minute: minute.trim() === "" ? null : Number(minute),
      ownGoal,
      penalty,
    });
  };

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t("matchEventsAddGoal")}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error && <Alert severity="error" sx={{ borderRadius: 2 }}>{error}</Alert>}
          {roster.length === 0 && emptyPlayersHint && (
            <Alert severity="info" sx={{ borderRadius: 2 }}>{emptyPlayersHint}</Alert>
          )}

          {teamNames.length > 1 && (
            <TextField
              select label={t("matchEventsScoringTeam")} value={String(teamIndex)} fullWidth
              onChange={(e) => { setTeamIndex(Number(e.target.value)); setScorerName(""); setAssistName(""); }}
            >
              {teamNames.map((name, i) => <MenuItem key={name} value={String(i)}>{name}</MenuItem>)}
            </TextField>
          )}

          <Stack direction="row" spacing={1}>
            <Button
              variant={ownGoal ? "contained" : "outlined"} size="small"
              onClick={() => { setOwnGoal(!ownGoal); setScorerName(""); setAssistName(""); }}
              sx={{ borderRadius: 2, textTransform: "none" }}
            >
              {t("matchEventsOwnGoal")}
            </Button>
            <Button
              variant={penalty ? "contained" : "outlined"} size="small"
              onClick={() => setPenalty(!penalty)}
              sx={{ borderRadius: 2, textTransform: "none" }}
            >
              {t("matchEventsPenalty")}
            </Button>
          </Stack>

          <TextField
            select label={t("matchEventsScorer")} value={scorerName} fullWidth required
            onChange={(e) => { setScorerName(e.target.value); if (e.target.value === assistName) setAssistName(""); }}
          >
            {roster.map((name) => <MenuItem key={name} value={name}>{name}</MenuItem>)}
          </TextField>

          {!ownGoal && (
            <TextField
              select label={t("matchEventsAssist")} value={assistName} fullWidth
              onChange={(e) => setAssistName(e.target.value)}
            >
              <MenuItem value="">{t("matchEventsNoAssist")}</MenuItem>
              {roster.filter((n) => n !== scorerName).map((name) => <MenuItem key={name} value={name}>{name}</MenuItem>)}
            </TextField>
          )}

          <TextField
            label={t("matchEventsMinuteLabel")} value={minute} fullWidth
            onChange={(e) => setMinute(e.target.value.replace(/\D/g, "").slice(0, 3))}
          />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} disabled={saving}>{t("cancel")}</Button>
        <Button variant="contained" onClick={submit} disabled={saving || !scorerName}>
          {saving ? t("loading") : t("matchEventsAddGoal")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
