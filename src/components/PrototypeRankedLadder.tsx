/**
 * PROTOTYPE — Ranked ladder UX, Variant A (throwaway).
 * Renders inside the real app shell (ThemeModeProvider + ResponsiveLayout + MUI)
 * with stub Rank/Tier data, since the Rank layer is not implemented yet.
 *
 * Members see their state DERIVED, never chosen:
 *   - provisional is per-player (games < 3)
 *   - the new-season banner is transient (shown right after a reset)
 * The state tabs are an ADMIN-ONLY preview, off by default.
 *
 * Winner of ticket dex 20jkpipd. Do not promote as-is.
 */
import { useState } from "react";
import {
  Container, Paper, Typography, Box, Stack, Chip, Button, Avatar,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  LinearProgress, Alert, alpha, useTheme, ToggleButton, ToggleButtonGroup,
  FormControlLabel, Switch,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { ThemeModeProvider } from "./ThemeModeProvider";
import { ResponsiveLayout } from "./ResponsiveLayout";

const EDGES = [0, 75, 102, 107, 118, 213];
const NAMES = ["Bronze", "Silver", "Gold", "Platinum", "Diamond", "Master"];
const TIER_COLORS = ["#8c6a4a", "#8892a0", "#c9a227", "#3fa8a0", "#5b8def", "#9b6bff"];
const ANCHOR = 879;

type Row = { name: string; rating: number; games: number; wins: number; draws: number; losses: number; you?: boolean };
const DATA: Row[] = [
  { name: "Rita", rating: 1114, games: 11, wins: 9, draws: 0, losses: 2 },
  { name: "Marco", rating: 1092, games: 12, wins: 9, draws: 0, losses: 3 },
  { name: "You", rating: 1073, games: 8, wins: 6, draws: 0, losses: 2, you: true },
  { name: "Inês", rating: 997, games: 10, wins: 5, draws: 0, losses: 5 },
  { name: "Tomás", rating: 995, games: 13, wins: 6, draws: 0, losses: 7 },
  { name: "Sofia", rating: 986, games: 7, wins: 3, draws: 0, losses: 4 },
  { name: "Bruno", rating: 984, games: 8, wins: 3, draws: 0, losses: 5 },
  { name: "Ana", rating: 981, games: 5, wins: 2, draws: 0, losses: 3 },
  { name: "João", rating: 979, games: 3, wins: 1, draws: 0, losses: 2 },
  { name: "Rui", rating: 957, games: 4, wins: 1, draws: 0, losses: 3 },
  { name: "Nuno", rating: 935, games: 13, wins: 4, draws: 0, losses: 9 },
  { name: "Pedro", rating: 1000, games: 1, wins: 0, draws: 0, losses: 1 },
  { name: "Lia", rating: 1000, games: 2, wins: 1, draws: 0, losses: 1 },
];

const tierOf = (s: number) => { let b = 0; for (let i = 0; i < EDGES.length; i++) if (s >= EDGES[i]) b = i; return b; };
const nextEdge = (s: number) => EDGES.find((e) => e > s) ?? null;

type Scenario = "established" | "provisional" | "newseason";

export default function PrototypeRankedLadder() {
  const theme = useTheme();
  const [adminPreview, setAdminPreview] = useState(false);
  const [scenario, setScenario] = useState<Scenario>("established");

  const seedOf = (r: Row) => Math.max(0, r.rating - ANCHOR);
  const youRow = DATA.find((r) => r.you)!;
  const newSeason = adminPreview && scenario === "newseason";
  const youSeed = newSeason ? Math.round(seedOf(youRow) * 0.5) : seedOf(youRow);
  const forceYouProvisional = adminPreview && scenario === "provisional";

  // Established first (by seed desc), provisional (games < 3) last, as "—".
  const rows = [...DATA]
    .map((r) => ({ r, provisional: forceYouProvisional && r.you ? true : r.games < 3 }))
    .sort((a, b) => Number(a.provisional) - Number(b.provisional) || seedOf(b.r) - seedOf(a.r))
    .map(({ r, provisional }) => {
      const seed = r.you ? youSeed : seedOf(r);
      const t = tierOf(seed);
      const hi = nextEdge(seed);
      const lo = EDGES[t];
      const pct = hi === null ? 100 : Math.round(((seed - lo) / (hi - lo)) * 100);
      return { r, provisional, seed, t, pct, to: hi === null ? 0 : hi - seed, next: hi === null ? null : NAMES[t + 1] };
    });

  const tierChip = (t: number, provisional: boolean) => {
    if (provisional) {
      return <Chip label="Provisional" size="small" variant="outlined" sx={{ fontWeight: 700, color: "text.secondary" }} />;
    }
    const c = TIER_COLORS[t];
    return (
      <Chip
        label={NAMES[t]}
        size="small"
        sx={{ fontWeight: 700, color: c, bgcolor: alpha(c, 0.14), border: `1px solid ${alpha(c, 0.45)}` }}
      />
    );
  };

  return (
    <ThemeModeProvider>
      <ResponsiveLayout>
        <Container maxWidth="md" sx={{ py: 3 }}>
          <Stack spacing={2}>
            <Button startIcon={<ArrowBackIcon />} href="#" sx={{ alignSelf: "flex-start" }}>
              Back
            </Button>
            <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 2, flexWrap: "wrap" }}>
              <Box>
                <Typography variant="h5" fontWeight={700}>Ratings</Typography>
                <Typography variant="body2" color="text.secondary">
                  Season Rank · friendly games don’t affect Rank
                </Typography>
              </Box>
              <FormControlLabel
                control={<Switch size="small" checked={adminPreview} onChange={(_, v) => setAdminPreview(v)} />}
                label={<Typography variant="caption">Admin preview</Typography>}
              />
            </Box>

            {adminPreview ? (
              <Box>
                <ToggleButtonGroup
                  exclusive
                  size="small"
                  value={scenario}
                  onChange={(_, v) => v && setScenario(v)}
                  sx={{ flexWrap: "wrap" }}
                >
                  <ToggleButton value="established">Established</ToggleButton>
                  <ToggleButton value="provisional">Provisional (&lt;3 games)</ToggleButton>
                  <ToggleButton value="newseason">New Season / reset</ToggleButton>
                </ToggleButtonGroup>
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
                  Admin-only preview. Members never see these tabs — their state is derived.
                </Typography>
              </Box>
            ) : (
              <Typography variant="caption" color="text.secondary">
                Provisional players show automatically. A reset banner appears on its own right after a new Season starts.
              </Typography>
            )}

            {newSeason && (
              <Alert severity="info">
                Season 3 has started. Your Rank soft-reset from <b>Diamond {seedOf(youRow)}</b> to{" "}
                <b>{NAMES[tierOf(youSeed)]} {youSeed}</b> — re-earn your spot. No attendance pressure.
              </Alert>
            )}

            <Paper elevation={2} sx={{ borderRadius: 3, overflow: "hidden" }}>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ bgcolor: alpha(theme.palette.primary.main, theme.palette.mode === "dark" ? 0.15 : 0.06) }}>
                      <TableCell sx={{ fontWeight: 700, width: 44 }}>#</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Player</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Tier</TableCell>
                      <TableCell align="center" sx={{ fontWeight: 700 }}>Rank</TableCell>
                      <TableCell sx={{ fontWeight: 700, width: 170 }}>Progress to next</TableCell>
                      <TableCell align="center" sx={{ fontWeight: 700 }}>G</TableCell>
                      <TableCell align="center" sx={{ fontWeight: 700, color: "success.main" }}>W</TableCell>
                      <TableCell align="center" sx={{ fontWeight: 700, color: "text.secondary" }}>D</TableCell>
                      <TableCell align="center" sx={{ fontWeight: 700, color: "error.main" }}>L</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {rows.map(({ r, provisional, seed, t, pct, to, next }, i) => (
                      <TableRow
                        key={r.name}
                        sx={{ bgcolor: r.you ? alpha(theme.palette.primary.main, 0.08) : undefined, "&:last-child td": { borderBottom: 0 } }}
                      >
                        <TableCell>
                          {!provisional && i < 3 ? (
                            <Avatar sx={{ width: 26, height: 26, fontSize: "0.75rem", fontWeight: 700, bgcolor: alpha(theme.palette.primary.main, 0.18) }}>
                              {i + 1}
                            </Avatar>
                          ) : (
                            <Typography variant="body2" color="text.secondary">{provisional ? "—" : i + 1}</Typography>
                          )}
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" fontWeight={r.you ? 700 : 500}>{r.name}</Typography>
                        </TableCell>
                        <TableCell>{tierChip(t, provisional)}</TableCell>
                        <TableCell align="center">
                          {provisional ? (
                            <Typography variant="body2" color="text.secondary">—</Typography>
                          ) : (
                            <Chip
                              label={seed}
                              size="small"
                              variant="outlined"
                              sx={{ fontWeight: 700, minWidth: 52, bgcolor: alpha(TIER_COLORS[t], 0.1), borderColor: alpha(TIER_COLORS[t], 0.3), color: TIER_COLORS[t] }}
                            />
                          )}
                        </TableCell>
                        <TableCell>
                          {provisional ? (
                            <Typography variant="caption" color="text.secondary">
                              unlocks at 3 games ({r.games}/3)
                            </Typography>
                          ) : (
                            <Box>
                              <LinearProgress
                                variant="determinate"
                                value={pct}
                                sx={{
                                  height: 7, borderRadius: 4,
                                  bgcolor: alpha(theme.palette.text.primary, 0.08),
                                  "& .MuiLinearProgress-bar": { bgcolor: TIER_COLORS[t], borderRadius: 4 },
                                }}
                              />
                              <Typography variant="caption" color="text.secondary">
                                {next ? `${to} to ${next}` : "Top tier"}
                              </Typography>
                            </Box>
                          )}
                        </TableCell>
                        <TableCell align="center"><Typography variant="body2">{r.games}</Typography></TableCell>
                        <TableCell align="center"><Typography variant="body2" color="success.main" fontWeight={600}>{r.wins}</Typography></TableCell>
                        <TableCell align="center"><Typography variant="body2" color="text.secondary">{r.draws}</Typography></TableCell>
                        <TableCell align="center"><Typography variant="body2" color="error.main" fontWeight={600}>{r.losses}</Typography></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>

            <Typography variant="caption" color="text.secondary">
              PROTOTYPE (Variant A). Stub Rank/Tier from real tier bands; Rank layer not implemented yet.
            </Typography>
          </Stack>
        </Container>
      </ResponsiveLayout>
    </ThemeModeProvider>
  );
}
