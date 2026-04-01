import React, { useState, useEffect, useCallback } from "react";
import {
  Container, Typography, Stack, Box, Paper, Grid2,
  CircularProgress, Alert, TextField, Button,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  InputAdornment, Chip, ToggleButtonGroup, ToggleButton, useTheme,
  IconButton, Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions,
} from "@mui/material";
import PeopleIcon from "@mui/icons-material/People";
import EventIcon from "@mui/icons-material/Event";
import SportsScoreIcon from "@mui/icons-material/SportsScore";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import SearchIcon from "@mui/icons-material/Search";
import DeleteIcon from "@mui/icons-material/Delete";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer } from "recharts";
import { ThemeModeProvider } from "./ThemeModeProvider";
import { ResponsiveLayout } from "./ResponsiveLayout";
import { useT } from "~/lib/useT";
import { useSession } from "~/lib/auth.client";

interface AdminStats {
  totalUsers: number;
  totalEvents: number;
  totalGamesPlayed: number;
  activeEvents: number;
  activeUsers: number;
  gamesLast7d: number;
  gamesLast30d: number;
  avgPlayersPerEvent: number;
  recurringEvents: number;
  oneOffEvents: number;
  sportDistribution: Record<string, number>;
}

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: string;
  createdAt: string;
}

interface GrowthPoint {
  date: string;
  users: number;
  events: number;
}

type GrowthRange = "30d" | "1y" | "all";

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) {
  const theme = useTheme();
  if (!active || !payload?.length) return null;
  const isDark = theme.palette.mode === "dark";
  return (
    <div style={{
      backgroundColor: isDark ? "#1a1d1b" : "#fff",
      border: `1px solid ${isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.12)"}`,
      borderRadius: 8,
      padding: 10,
      color: isDark ? "#fff" : "rgba(0,0,0,0.87)",
    }}>
      <p style={{ margin: 0, marginBottom: 4 }}>{label}</p>
      {payload.map((entry, i) => (
        <p key={i} style={{ margin: 0, color: entry.color }}>
          {entry.name} : {entry.value}
        </p>
      ))}
    </div>
  );
}

function GrowthChart({ growthData, growthRange, setGrowthRange, loadingGrowth }: {
  growthData: GrowthPoint[];
  growthRange: GrowthRange;
  setGrowthRange: (v: GrowthRange) => void;
  loadingGrowth: boolean;
}) {
  const t = useT();
  const theme = useTheme();
  const isDark = theme.palette.mode === "dark";
  return (
    <Paper elevation={1} sx={{ p: 3 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Typography variant="h6" fontWeight={600}>{t("adminGrowthChart")}</Typography>
        <ToggleButtonGroup
          size="small"
          value={growthRange}
          exclusive
          onChange={(_, v) => { if (v) setGrowthRange(v); }}
        >
          <ToggleButton value="30d">{t("adminRange30d")}</ToggleButton>
          <ToggleButton value="1y">{t("adminRange1y")}</ToggleButton>
          <ToggleButton value="all">{t("adminRangeAll")}</ToggleButton>
        </ToggleButtonGroup>
      </Stack>
      {loadingGrowth ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}><CircularProgress size={24} /></Box>
      ) : growthData.length === 0 ? (
        <Alert severity="info">{t("adminNoGrowthData")}</Alert>
      ) : (
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={growthData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={isDark ? "rgba(255,255,255,0.12)" : theme.palette.divider} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11, fill: isDark ? "#fff" : "rgba(0,0,0,0.87)" }}
              stroke={isDark ? "rgba(255,255,255,0.5)" : theme.palette.text.secondary}
              tickLine={{ stroke: isDark ? "rgba(255,255,255,0.3)" : theme.palette.text.secondary }}
              axisLine={{ stroke: isDark ? "rgba(255,255,255,0.3)" : theme.palette.text.secondary }}
              tickFormatter={(v: string) => {
                const d = new Date(v);
                return `${d.getMonth() + 1}/${d.getDate()}`;
              }}
            />
            <YAxis
              tick={{ fontSize: 11, fill: isDark ? "#fff" : "rgba(0,0,0,0.87)" }}
              stroke={isDark ? "rgba(255,255,255,0.5)" : theme.palette.text.secondary}
              tickLine={{ stroke: isDark ? "rgba(255,255,255,0.3)" : theme.palette.text.secondary }}
              axisLine={{ stroke: isDark ? "rgba(255,255,255,0.3)" : theme.palette.text.secondary }}
            />
            <RechartsTooltip content={<ChartTooltip />} />
            <Legend wrapperStyle={{ color: isDark ? "#fff" : "rgba(0,0,0,0.87)" }} />
            <Line
              type="monotone"
              dataKey="users"
              name={t("adminTotalUsers")}
              stroke={isDark ? "#64b5f6" : theme.palette.primary.main}
              strokeWidth={2}
              dot={{ r: 3 }}
              activeDot={{ r: 5 }}
            />
            <Line
              type="monotone"
              dataKey="events"
              name={t("adminTotalEvents")}
              stroke={isDark ? "#f48fb1" : theme.palette.secondary.main}
              strokeWidth={2}
              dot={{ r: 3 }}
              activeDot={{ r: 5 }}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </Paper>
  );
}

function StatCard({ label, value, icon }: { label: string; value: number | string; icon: React.ReactNode }) {
  return (
    <Paper elevation={1} sx={{ p: 2.5, display: "flex", alignItems: "center", gap: 2 }}>
      <Box sx={{ color: "primary.main", display: "flex" }}>{icon}</Box>
      <Box>
        <Typography variant="h5" fontWeight={700}>{value}</Typography>
        <Typography variant="body2" color="text.secondary">{label}</Typography>
      </Box>
    </Paper>
  );
}

export default function AdminDashboardPage() {
  const t = useT();
  const { data: session, isPending: sessionLoading } = useSession();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [userTotal, setUserTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [growthRange, setGrowthRange] = useState<GrowthRange>("30d");
  const [growthData, setGrowthData] = useState<GrowthPoint[]>([]);
  const [loadingGrowth, setLoadingGrowth] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<UserRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const PAGE_SIZE = 20;

  useEffect(() => {
    if (!session?.user) return;
    fetch("/api/admin/stats")
      .then((r) => {
        if (r.status === 403) { setForbidden(true); setLoading(false); return null; }
        return r.json();
      })
      .then((data) => { if (data) { setStats(data); setLoading(false); } });
  }, [session?.user]);

  // Fetch growth timeline
  useEffect(() => {
    if (!session?.user || forbidden) return;
    setLoadingGrowth(true);
    fetch(`/api/admin/growth?range=${growthRange}`)
      .then((r) => r.ok ? r.json() : [])
      .then((data) => { setGrowthData(data); setLoadingGrowth(false); })
      .catch(() => setLoadingGrowth(false));
  }, [session?.user, forbidden, growthRange]);

  const fetchUsers = useCallback(async (p: number, q: string) => {
    setLoadingUsers(true);
    const params = new URLSearchParams({ page: String(p), pageSize: String(PAGE_SIZE) });
    if (q) params.set("search", q);
    const r = await fetch(`/api/admin/users?${params}`);
    if (r.ok) {
      const data = await r.json();
      setUsers(data.users);
      setUserTotal(data.total);
    }
    setLoadingUsers(false);
  }, []);

  useEffect(() => {
    if (!session?.user || forbidden) return;
    fetchUsers(page, search);
  }, [session?.user, page, search, forbidden, fetchUsers]);

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);
    const r = await fetch(`/api/admin/users/${deleteTarget.id}`, { method: "DELETE" });
    if (r.ok) {
      setDeleteTarget(null);
      fetchUsers(page, search);
    } else {
      setDeleteError(t("adminDeleteUserError"));
    }
    setDeleting(false);
  };

  if (sessionLoading) {
    return (
      <ThemeModeProvider><ResponsiveLayout>
        <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}><CircularProgress /></Box>
      </ResponsiveLayout></ThemeModeProvider>
    );
  }

  if (!session?.user) {
    return (
      <ThemeModeProvider><ResponsiveLayout>
        <Container maxWidth="sm" sx={{ py: 8, textAlign: "center" }}>
          <Typography variant="h5" fontWeight={700} gutterBottom>{t("signIn")}</Typography>
          <Button variant="contained" href="/auth/signin">{t("signIn")}</Button>
        </Container>
      </ResponsiveLayout></ThemeModeProvider>
    );
  }

  if (forbidden) {
    return (
      <ThemeModeProvider><ResponsiveLayout>
        <Container maxWidth="sm" sx={{ py: 8, textAlign: "center" }}>
          <Alert severity="error">{t("adminForbidden")}</Alert>
        </Container>
      </ResponsiveLayout></ThemeModeProvider>
    );
  }

  return (
    <ThemeModeProvider>
      <ResponsiveLayout>
        <Container maxWidth="lg" sx={{ py: 4 }}>
          <Stack spacing={4}>
            <Box>
              <Typography variant="h4" fontWeight={700}>{t("adminDashboard")}</Typography>
              <Typography variant="body2" color="text.secondary">{t("adminDashboardDesc")}</Typography>
            </Box>

            {loading || !stats ? (
              <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}><CircularProgress /></Box>
            ) : (
              <>
                {/* Top-level stat cards */}
                <Grid2 container spacing={2}>
                  <Grid2 size={{ xs: 6, md: 3 }}>
                    <StatCard label={t("adminTotalUsers")} value={stats.totalUsers} icon={<PeopleIcon />} />
                  </Grid2>
                  <Grid2 size={{ xs: 6, md: 3 }}>
                    <StatCard label={t("adminTotalEvents")} value={stats.totalEvents} icon={<EventIcon />} />
                  </Grid2>
                  <Grid2 size={{ xs: 6, md: 3 }}>
                    <StatCard label={t("adminGamesPlayed")} value={stats.totalGamesPlayed} icon={<SportsScoreIcon />} />
                  </Grid2>
                  <Grid2 size={{ xs: 6, md: 3 }}>
                    <StatCard label={t("adminActiveUsers")} value={stats.activeUsers} icon={<TrendingUpIcon />} />
                  </Grid2>
                </Grid2>

                {/* Secondary metrics */}
                <Grid2 container spacing={2}>
                  <Grid2 size={{ xs: 6, sm: 4, md: 2 }}>
                    <StatCard label={t("adminActiveEvents")} value={stats.activeEvents} icon={<EventIcon fontSize="small" />} />
                  </Grid2>
                  <Grid2 size={{ xs: 6, sm: 4, md: 2 }}>
                    <StatCard label={t("adminGamesLast7d")} value={stats.gamesLast7d} icon={<SportsScoreIcon fontSize="small" />} />
                  </Grid2>
                  <Grid2 size={{ xs: 6, sm: 4, md: 2 }}>
                    <StatCard label={t("adminGamesLast30d")} value={stats.gamesLast30d} icon={<SportsScoreIcon fontSize="small" />} />
                  </Grid2>
                  <Grid2 size={{ xs: 6, sm: 4, md: 2 }}>
                    <StatCard label={t("adminAvgPlayers")} value={stats.avgPlayersPerEvent} icon={<PeopleIcon fontSize="small" />} />
                  </Grid2>
                  <Grid2 size={{ xs: 6, sm: 4, md: 2 }}>
                    <StatCard label={t("adminRecurringEvents")} value={stats.recurringEvents} icon={<EventIcon fontSize="small" />} />
                  </Grid2>
                  <Grid2 size={{ xs: 6, sm: 4, md: 2 }}>
                    <StatCard label={t("adminOneOffEvents")} value={stats.oneOffEvents} icon={<EventIcon fontSize="small" />} />
                  </Grid2>
                </Grid2>

                {/* Sport distribution */}
                {Object.keys(stats.sportDistribution).length > 0 && (
                  <Paper elevation={1} sx={{ p: 3 }}>
                    <Typography variant="h6" fontWeight={600} gutterBottom>{t("adminSportDistribution")}</Typography>
                    <Stack direction="row" flexWrap="wrap" gap={1}>
                      {Object.entries(stats.sportDistribution)
                        .sort(([, a], [, b]) => b - a)
                        .map(([sport, count]) => (
                          <Chip key={sport} label={`${sport} (${count})`} variant="outlined" />
                        ))}
                    </Stack>
                  </Paper>
                )}

                <GrowthChart growthData={growthData} growthRange={growthRange} setGrowthRange={setGrowthRange} loadingGrowth={loadingGrowth} />

                {/* User list */}
                <Paper elevation={1} sx={{ p: 3 }}>
                  <Typography variant="h6" fontWeight={600} gutterBottom>{t("adminUserList")}</Typography>
                  <TextField
                    size="small"
                    placeholder={t("adminSearchUsers")}
                    value={search}
                    onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                    slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> } }}
                    sx={{ mb: 2, maxWidth: 360 }}
                    fullWidth
                  />
                  {loadingUsers ? (
                    <Box sx={{ display: "flex", justifyContent: "center", py: 2 }}><CircularProgress size={24} /></Box>
                  ) : users.length === 0 ? (
                    <Alert severity="info">{t("adminNoUsers")}</Alert>
                  ) : (
                    <>
                      <TableContainer>
                        <Table size="small">
                          <TableHead>
                            <TableRow>
                              <TableCell>{t("name")}</TableCell>
                              <TableCell>{t("email")}</TableCell>
                              <TableCell>Joined</TableCell>
                              <TableCell />
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {users.map((u) => (
                              <TableRow key={u.id} hover>
                                <TableCell>
                                  <Typography
                                    component="a"
                                    href={`/users/${u.id}`}
                                    variant="body2"
                                    sx={{ textDecoration: "none", color: "primary.main", "&:hover": { textDecoration: "underline" } }}
                                  >
                                    {u.name}
                                  </Typography>
                                </TableCell>
                                <TableCell>{u.email}</TableCell>
                                <TableCell>{new Date(u.createdAt).toLocaleDateString()}</TableCell>
                                <TableCell align="right">
                                  {u.id !== session?.user?.id && (
                                    <IconButton
                                      size="small"
                                      color="error"
                                      aria-label={t("adminDeleteUser")}
                                      onClick={() => { setDeleteError(null); setDeleteTarget(u); }}
                                    >
                                      <DeleteIcon fontSize="small" />
                                    </IconButton>
                                  )}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </TableContainer>
                      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 2 }}>
                        <Typography variant="caption" color="text.secondary">
                          {users.length} / {userTotal}
                        </Typography>
                        <Stack direction="row" spacing={1}>
                          <Button size="small" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Prev</Button>
                          <Button size="small" disabled={page * PAGE_SIZE >= userTotal} onClick={() => setPage((p) => p + 1)}>Next</Button>
                        </Stack>
                      </Stack>
                    </>
                  )}
                </Paper>
              </>
            )}
          </Stack>
        </Container>
      </ResponsiveLayout>
      <Dialog open={!!deleteTarget} onClose={() => !deleting && setDeleteTarget(null)}>
        <DialogTitle>{t("adminDeleteUser")}</DialogTitle>
        <DialogContent>
          <DialogContentText>{t("adminDeleteUserConfirm")}</DialogContentText>
          {deleteTarget && (
            <Typography variant="body2" sx={{ mt: 1 }}>
              {deleteTarget.name} ({deleteTarget.email})
            </Typography>
          )}
          {deleteError && <Alert severity="error" sx={{ mt: 1 }}>{deleteError}</Alert>}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)} disabled={deleting}>{t("cancel")}</Button>
          <Button color="error" variant="contained" onClick={handleDeleteConfirm} disabled={deleting}>
            {deleting ? t("deleting") : t("adminDeleteUser")}
          </Button>
        </DialogActions>
      </Dialog>
    </ThemeModeProvider>
  );
}
