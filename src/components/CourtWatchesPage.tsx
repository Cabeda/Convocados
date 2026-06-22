import React, { useState, useEffect, useCallback } from "react";
import {
  Container, Typography, Stack, Box, Card, CardContent, Chip,
  CircularProgress, Alert, IconButton, Divider,
} from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import PlaceIcon from "@mui/icons-material/Place";
import { ThemeModeProvider } from "./ThemeModeProvider";
import { ResponsiveLayout } from "./ResponsiveLayout";
import { useT } from "~/lib/useT";
import { useSession } from "~/lib/auth.client";

interface CourtWatch {
  id: string;
  sport: string;
  tenantName: string;
  resourceName: string | null;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  timezone: string;
  maxPrice: number | null;
}

const WEEKDAY_KEYS = [
  "sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday",
] as const;

export default function CourtWatchesPage() {
  const t = useT();
  const { data: session, isPending: sessionLoading } = useSession();
  const [watches, setWatches] = useState<CourtWatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/court-watches");
      if (!res.ok) { setError(t("somethingWentWrong")); return; }
      const data = await res.json();
      setWatches(data.watches ?? []);
    } catch {
      setError(t("somethingWentWrong"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!sessionLoading && session?.user) load();
    else if (!sessionLoading) setLoading(false);
  }, [sessionLoading, session, load]);

  const remove = useCallback(async (id: string) => {
    const res = await fetch(`/api/court-watches/${id}`, { method: "DELETE" });
    if (res.ok) setWatches((prev) => prev.filter((w) => w.id !== id));
  }, []);

  const weekdayLabel = (dow: number) => t(WEEKDAY_KEYS[dow] ?? "sunday");

  return (
    <ThemeModeProvider>
      <ResponsiveLayout>
        <Container maxWidth="sm" sx={{ py: 3 }}>
          <Typography variant="h5" gutterBottom>{t("courtWatchesTitle")}</Typography>
          <Typography variant="body2" color="text.secondary" gutterBottom>{t("courtWatchesDesc")}</Typography>

          {error && <Alert severity="error" sx={{ my: 2 }}>{error}</Alert>}

          {loading ? (
            <Box textAlign="center" py={4}><CircularProgress /></Box>
          ) : watches.length === 0 ? (
            <Alert severity="info" sx={{ mt: 2 }}>{t("courtWatchesEmpty")}</Alert>
          ) : (
            <Stack spacing={1.5} sx={{ mt: 2 }}>
              {watches.map((w) => (
                <Card key={w.id} variant="outlined">
                  <CardContent sx={{ pb: "12px !important" }}>
                    <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                      <Box sx={{ minWidth: 0 }}>
                        <Typography variant="subtitle2" fontWeight={600}>{w.tenantName}</Typography>
                        {w.resourceName && (
                          <Stack direction="row" spacing={0.5} alignItems="center">
                            <PlaceIcon sx={{ fontSize: 12, color: "text.secondary" }} />
                            <Typography variant="caption" color="text.secondary">{w.resourceName}</Typography>
                          </Stack>
                        )}
                        <Stack direction="row" spacing={0.5} sx={{ mt: 1 }} flexWrap="wrap" useFlexGap>
                          <Chip size="small" label={t("courtWatchEveryWeekday").replace("{weekday}", weekdayLabel(w.dayOfWeek))} />
                          <Chip size="small" variant="outlined" label={`${w.startTime}–${w.endTime} ${w.timezone}`} />
                          <Chip size="small" variant="outlined" label={`${w.durationMinutes}min`} />
                          {w.maxPrice !== null && <Chip size="small" color="success" variant="outlined" label={`≤ ${w.maxPrice}`} />}
                        </Stack>
                      </Box>
                      <IconButton size="small" color="error" onClick={() => remove(w.id)} title={t("courtWatchDelete")}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Stack>
                  </CardContent>
                </Card>
              ))}
            </Stack>
          )}
          <Divider sx={{ mt: 3 }} />
        </Container>
      </ResponsiveLayout>
    </ThemeModeProvider>
  );
}
