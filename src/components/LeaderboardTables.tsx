import {
  Alert, Box, Chip, FormControl, Grid, InputLabel, MenuItem, Paper, Select,
  Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography,
} from "@mui/material";
import { EmojiEvents } from "@mui/icons-material";
import { useT } from "~/lib/useT";
import type { CrewStanding, LeaderboardResult, PlayerStanding } from "~/lib/leaderboard";

export interface LeaderboardScope {
  type: "event" | "season";
  seasonId: string | null;
  name: string | null;
  startsAt: string | null;
  endsAt: string | null;
}

export interface LeaderboardPayload extends LeaderboardResult {
  scope: LeaderboardScope;
  hidden?: boolean;
}

export interface LeaderboardSeasonOption {
  id: string;
  name: string;
  status: string;
}

interface LeaderboardTablesProps {
  data: LeaderboardPayload | null;
  loading: boolean;
  selectedScopeId: string;
  seasonOptions: LeaderboardSeasonOption[];
  onScopeChange: (scopeId: string) => void;
}

function StatHeader({ label, title }: { label: string; title: string }) {
  return <TableCell align="right" title={title} sx={{ fontWeight: 700, whiteSpace: "nowrap" }}>{label}</TableCell>;
}

function PlayerStandingsTable({ rows, label }: { rows: PlayerStanding[]; label: string }) {
  const t = useT();
  return (
    <TableContainer sx={{ overflowX: "auto" }}>
      <Table size="small" aria-label={label}>
        <TableHead>
          <TableRow>
            <TableCell sx={{ fontWeight: 700 }}>#</TableCell>
            <TableCell sx={{ fontWeight: 700, minWidth: 140 }}>{label}</TableCell>
            <StatHeader label={t("leaderboardPoints")} title={t("leaderboardPoints")} />
            <StatHeader label={t("leaderboardPlayed")} title={t("leaderboardPlayed")} />
            <StatHeader label={t("leaderboardWins")} title={t("leaderboardWins")} />
            <StatHeader label={t("leaderboardDraws")} title={t("leaderboardDraws")} />
            <StatHeader label={t("leaderboardLosses")} title={t("leaderboardLosses")} />
            <StatHeader label={t("leaderboardGoalsFor")} title={t("leaderboardGoalsFor")} />
            <StatHeader label={t("leaderboardGoalsAgainst")} title={t("leaderboardGoalsAgainst")} />
            <StatHeader label={t("leaderboardGoalDifference")} title={t("leaderboardGoalDifference")} />
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.name}>
              <TableCell sx={{ color: "text.secondary", fontWeight: 700 }}>{row.rank}</TableCell>
              <TableCell sx={{ fontWeight: row.rank === 1 ? 700 : 500 }}>
                <Stack direction="row" spacing={0.75} sx={{ alignItems: "center", flexWrap: "wrap", gap: 0.5 }}>
                  <Box component="span" sx={{ whiteSpace: "nowrap" }}>{row.name}</Box>
                  {row.crewName && (
                    <Chip
                      size="small"
                      variant="outlined"
                      label={row.crewName}
                      sx={{ height: 18, fontSize: "0.65rem", "& .MuiChip-label": { px: 0.75 } }}
                    />
                  )}
                </Stack>
              </TableCell>
              <TableCell align="right" sx={{ fontWeight: 700 }}>{row.points}</TableCell>
              <TableCell align="right">{row.played}</TableCell>
              <TableCell align="right">{row.wins}</TableCell>
              <TableCell align="right">{row.draws}</TableCell>
              <TableCell align="right">{row.losses}</TableCell>
              <TableCell align="right">{row.goalsFor}</TableCell>
              <TableCell align="right">{row.goalsAgainst}</TableCell>
              <TableCell align="right" sx={{ color: row.goalDifference > 0 ? "success.main" : row.goalDifference < 0 ? "error.main" : "text.secondary" }}>
                {row.goalDifference > 0 ? "+" : ""}{row.goalDifference}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

function CrewStandingsTable({ rows, label }: { rows: CrewStanding[]; label: string }) {
  const t = useT();
  return (
    <TableContainer sx={{ overflowX: "auto" }}>
      <Table size="small" aria-label={label}>
        <TableHead>
          <TableRow>
            <TableCell sx={{ fontWeight: 700 }}>#</TableCell>
            <TableCell sx={{ fontWeight: 700, minWidth: 140 }}>{label}</TableCell>
            <StatHeader label={t("leaderboardPoints")} title={t("crewBestSixTitle")} />
            <StatHeader label={t("leaderboardRounds")} title={t("crewRoundsTitle")} />
            <TableCell sx={{ fontWeight: 700, whiteSpace: "nowrap" }}>{t("crewGameScores")}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.crewId}>
              <TableCell sx={{ color: "text.secondary", fontWeight: 700 }}>{row.rank}</TableCell>
              <TableCell sx={{ fontWeight: row.rank === 1 ? 700 : 500, whiteSpace: "nowrap" }}>{row.name}</TableCell>
              <TableCell align="right" sx={{ fontWeight: 700 }} title={t("crewTieBreakTotal", { total: row.tieBreakTotal.toFixed(2) })}>
                {row.points.toFixed(2)}
              </TableCell>
              <TableCell align="right">{row.roundsCounted}/{row.roundsRepresented}</TableCell>
              <TableCell sx={{ minWidth: 160 }}>
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, maxWidth: 220 }}>
                  {row.gameScores.map((entry, index) => (
                    <Box
                      key={entry.gameId}
                      title={entry.counted ? t("crewScoreCounted") : t("crewScoreDropped")}
                      aria-label={`${t("crewGameScores")} ${index + 1}: ${entry.score.toFixed(2)}`}
                      sx={{
                        width: 44,
                        textAlign: "center",
                        py: 0.25,
                        borderRadius: 1,
                        fontVariantNumeric: "tabular-nums",
                        fontSize: "0.72rem",
                        fontWeight: entry.counted ? 700 : 400,
                        color: entry.counted ? "primary.contrastText" : "text.secondary",
                        bgcolor: entry.counted ? "primary.main" : "action.hover",
                        border: "1px solid",
                        borderColor: entry.counted ? "primary.main" : "divider",
                      }}
                    >
                      {entry.score.toFixed(2)}
                    </Box>
                  ))}
                </Box>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

function PlayerStandingsCard({ title, rows, label, emptyMessage }: {
  title: string;
  rows: PlayerStanding[];
  label: string;
  emptyMessage?: string;
}) {
  return (
    <Paper variant="outlined" sx={{ borderRadius: 3, overflow: "hidden" }}>
      <Box sx={{ px: 2, py: 1.5, borderBottom: "1px solid", borderColor: "divider" }}>
        <Typography variant="h6" fontWeight={700}>{title}</Typography>
      </Box>
      {rows.length > 0 ? <PlayerStandingsTable rows={rows} label={label} /> : <Alert severity="info" sx={{ m: 2 }}>{emptyMessage}</Alert>}
    </Paper>
  );
}

function CrewStandingsCard({ title, rows, label, emptyMessage }: {
  title: string;
  rows: CrewStanding[];
  label: string;
  emptyMessage?: string;
}) {
  return (
    <Paper variant="outlined" sx={{ borderRadius: 3, overflow: "hidden" }}>
      <Box sx={{ px: 2, py: 1.5, borderBottom: "1px solid", borderColor: "divider" }}>
        <Typography variant="h6" fontWeight={700}>{title}</Typography>
      </Box>
      {rows.length > 0 ? <CrewStandingsTable rows={rows} label={label} /> : <Alert severity="info" sx={{ m: 2 }}>{emptyMessage}</Alert>}
    </Paper>
  );
}

export function LeaderboardTables({ data, loading, selectedScopeId, seasonOptions, onScopeChange }: LeaderboardTablesProps) {
  const t = useT();
  if (loading && !data) return <Paper variant="outlined" sx={{ p: 3, borderRadius: 3 }}><Typography color="text.secondary">{t("loading")}</Typography></Paper>;
  if (!data) return null;
  if (data.hidden) return <Paper variant="outlined" sx={{ p: 2, borderRadius: 3 }}><Alert severity="info">{t("leaderboardHidden")}</Alert></Paper>;

  const scopeLabel = data.scope.type === "season" ? data.scope.name ?? t("season") : t("allGames");
  const availableSeasonOptions = seasonOptions.filter((season) => season.status !== "cancelled");
  return (
    <Stack spacing={2}>
      <Paper variant="outlined" sx={{ p: { xs: 2, sm: 2.5 }, borderRadius: 3 }}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ alignItems: { xs: "stretch", sm: "center" }, justifyContent: "space-between" }}>
          <Box>
            <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
              <EmojiEvents color="primary" />
              <Typography variant="h6" fontWeight={700}>{t("leaderboard")}</Typography>
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{t("leaderboardDescription")}</Typography>
            <Typography variant="caption" color="text.secondary">{scopeLabel} · {t("leaderboardGames", { n: data.gamesCount })}</Typography>
          </Box>
          {availableSeasonOptions.length > 0 && (
            <FormControl size="small" sx={{ minWidth: 220 }}>
              <InputLabel>{t("leaderboardScope")}</InputLabel>
              <Select label={t("leaderboardScope")} value={selectedScopeId} onChange={(event) => onScopeChange(event.target.value)}>
                <MenuItem value="all">{t("allGames")}</MenuItem>
                {availableSeasonOptions.map((season) => <MenuItem key={season.id} value={season.id}>{season.name}</MenuItem>)}
              </Select>
            </FormControl>
          )}
        </Stack>
      </Paper>

      {data.gamesCount === 0 ? (
        <Alert severity="info">{t("leaderboardNoGames")}</Alert>
      ) : (
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, xl: 7 }}>
            <PlayerStandingsCard title={t("playerLeague")} rows={data.players} label={t("leaderboardPlayer")} emptyMessage={t("leaderboardNoGames")} />
          </Grid>
          <Grid size={{ xs: 12, xl: 5 }}>
            <CrewStandingsCard title={t("crewLeague")} rows={data.crews} label={t("leaderboardCrew")} emptyMessage={t("leaderboardNoCrews")} />
          </Grid>
        </Grid>
      )}
    </Stack>
  );
}
