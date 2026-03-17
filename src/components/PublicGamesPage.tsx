import React, { useState, useMemo, useEffect, useCallback } from "react";
import useSWR from "swr";
import {
  Container, Paper, Typography, Box, Stack, Chip, Button,
  CircularProgress, alpha, useTheme, Grid2, ToggleButtonGroup, ToggleButton,
  FormControlLabel, Switch, FormControl, Select, MenuItem, InputLabel,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Alert,
} from "@mui/material";
import SportsIcon from "@mui/icons-material/Sports";
import LocationOnIcon from "@mui/icons-material/LocationOn";
import AccessTimeIcon from "@mui/icons-material/AccessTime";
import PeopleIcon from "@mui/icons-material/People";
import GridViewIcon from "@mui/icons-material/GridView";
import TableRowsIcon from "@mui/icons-material/TableRows";
import MapIcon from "@mui/icons-material/Map";
import { ThemeModeProvider } from "./ThemeModeProvider";
import { ResponsiveLayout } from "./ResponsiveLayout";
import { useT } from "~/lib/useT";
import { detectLocale } from "~/lib/i18n";
import { SPORT_PRESETS, getSportPreset } from "~/lib/sports";

interface PublicEvent {
  id: string;
  title: string;
  location: string;
  latitude: number | null;
  longitude: number | null;
  sport: string;
  dateTime: string;
  maxPlayers: number;
  playerCount: number;
  spotsLeft: number;
}

type ViewMode = "cards" | "table" | "map";

// ── Card view ─────────────────────────────────────────────────────────────────

function CardView({ events, locale, t, theme }: {
  events: PublicEvent[];
  locale: string;
  t: any;
  theme: any;
}) {
  return (
    <Grid2 container spacing={2}>
      {events.map((ev) => {
        const date = new Date(ev.dateTime);
        const isFull = ev.spotsLeft === 0;
        const sportPreset = getSportPreset(ev.sport);
        return (
          <Grid2 key={ev.id} size={{ xs: 12, sm: 6 }}>
            <Paper
              elevation={2}
              sx={{
                borderRadius: 3, p: 3, height: "100%",
                display: "flex", flexDirection: "column", gap: 1.5,
                transition: "transform 0.15s, box-shadow 0.15s",
                "&:hover": { transform: "translateY(-2px)", boxShadow: 6 },
              }}
            >
              <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <Typography variant="h6" fontWeight={700} noWrap sx={{ flex: 1 }}>
                  {ev.title}
                </Typography>
                <Chip
                  label={t(sportPreset.labelKey as any)}
                  size="small"
                  variant="outlined"
                  color="primary"
                  sx={{ ml: 1, flexShrink: 0 }}
                />
              </Box>

              <Stack spacing={0.5}>
                {ev.location && (
                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                    <LocationOnIcon fontSize="small" color="action" />
                    <Typography variant="body2" color="text.secondary" noWrap>
                      {ev.location}
                    </Typography>
                  </Box>
                )}
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                  <AccessTimeIcon fontSize="small" color="action" />
                  <Typography variant="body2" color="text.secondary">
                    {date.toLocaleString(locale === "pt" ? "pt-PT" : "en-GB", {
                      weekday: "short", month: "short", day: "numeric",
                      hour: "2-digit", minute: "2-digit",
                    })}
                  </Typography>
                </Box>
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                  <PeopleIcon fontSize="small" color="action" />
                  <Typography variant="body2" color="text.secondary">
                    {ev.playerCount}/{ev.maxPlayers}
                  </Typography>
                  {isFull ? (
                    <Chip label={t("full")} size="small" color="error" sx={{ ml: 0.5 }} />
                  ) : (
                    <Chip
                      label={t("spotsLeft", { n: ev.spotsLeft })}
                      size="small"
                      color="success"
                      sx={{ ml: 0.5 }}
                    />
                  )}
                </Box>
              </Stack>

              <Box sx={{ mt: "auto", pt: 1 }}>
                <Button
                  variant="contained"
                  fullWidth
                  href={`/events/${ev.id}`}
                  sx={{ borderRadius: 2 }}
                >
                  {t("joinGame")}
                </Button>
              </Box>
            </Paper>
          </Grid2>
        );
      })}
    </Grid2>
  );
}

// ── Table view ────────────────────────────────────────────────────────────────

function TableView({ events, locale, t }: {
  events: PublicEvent[];
  locale: string;
  t: any;
}) {
  return (
    <TableContainer component={Paper} elevation={2} sx={{ borderRadius: 3 }}>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell sx={{ fontWeight: 700 }}>{t("tableTitle")}</TableCell>
            <TableCell sx={{ fontWeight: 700 }}>{t("tableSport")}</TableCell>
            <TableCell sx={{ fontWeight: 700 }}>{t("tableLocation")}</TableCell>
            <TableCell sx={{ fontWeight: 700 }}>{t("tableDateTime")}</TableCell>
            <TableCell sx={{ fontWeight: 700 }}>{t("tablePlayers")}</TableCell>
            <TableCell sx={{ fontWeight: 700 }}>{t("tableStatus")}</TableCell>
            <TableCell />
          </TableRow>
        </TableHead>
        <TableBody>
          {events.map((ev) => {
            const date = new Date(ev.dateTime);
            const isFull = ev.spotsLeft === 0;
            const sportPreset = getSportPreset(ev.sport);
            return (
              <TableRow key={ev.id} hover>
                <TableCell>
                  <Typography variant="body2" fontWeight={600} noWrap>
                    {ev.title}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="body2" noWrap>
                    {t(sportPreset.labelKey as any)}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="body2" color="text.secondary" noWrap>
                    {ev.location || "—"}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="body2" color="text.secondary" noWrap>
                    {date.toLocaleString(locale === "pt" ? "pt-PT" : "en-GB", {
                      weekday: "short", month: "short", day: "numeric",
                      hour: "2-digit", minute: "2-digit",
                    })}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="body2">
                    {ev.playerCount}/{ev.maxPlayers}
                  </Typography>
                </TableCell>
                <TableCell>
                  {isFull ? (
                    <Chip label={t("full")} size="small" color="error" />
                  ) : (
                    <Chip label={t("spotsLeft", { n: ev.spotsLeft })} size="small" color="success" />
                  )}
                </TableCell>
                <TableCell>
                  <Button size="small" variant="contained" href={`/events/${ev.id}`} sx={{ borderRadius: 2 }}>
                    {t("joinGame")}
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

// ── Map view ──────────────────────────────────────────────────────────────────

interface GeoEvent extends PublicEvent {
  lat: number;
  lng: number;
}

function MapView({ events, t, locale }: {
  events: PublicEvent[];
  t: any;
  locale: string;
}) {
  const [userPos, setUserPos] = useState<[number, number] | null>(null);
  const [geoError, setGeoError] = useState(false);

  // Request user location
  useEffect(() => {
    if (!navigator.geolocation) {
      setGeoError(true);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => setUserPos([pos.coords.latitude, pos.coords.longitude]),
      () => setGeoError(true),
      { timeout: 8000 },
    );
  }, []);

  // Use stored coordinates — no client-side geocoding needed
  const geoEvents: GeoEvent[] = useMemo(() =>
    events
      .filter((ev) => ev.latitude != null && ev.longitude != null)
      .map((ev) => ({ ...ev, lat: ev.latitude!, lng: ev.longitude! })),
    [events],
  );

  const center = userPos ?? (geoEvents.length > 0 ? [geoEvents[0].lat, geoEvents[0].lng] as [number, number] : [39.5, -8.0] as [number, number]);

  return (
    <Stack spacing={1}>
      {geoError && (
        <Alert severity="info" sx={{ borderRadius: 2 }}>
          {t("mapPermissionDenied")}
        </Alert>
      )}
      <Paper elevation={2} sx={{ borderRadius: 3, overflow: "hidden", height: 450 }}>
        <iframe
          title="Events map"
          width="100%"
          height="100%"
          style={{ border: 0 }}
          sandbox="allow-scripts allow-top-navigation"
          src={buildMapUrl(center, geoEvents, t, locale)}
        />
      </Paper>
      {geoEvents.length === 0 && (
        <Alert severity="warning" sx={{ borderRadius: 2 }}>
          {t("mapNoLocation")}
        </Alert>
      )}
    </Stack>
  );
}

function buildMapUrl(
  center: [number, number],
  events: GeoEvent[],
  t: any,
  locale: string,
): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  const markers = events.map((ev) => {
    const sportPreset = getSportPreset(ev.sport);
    const label = `${ev.title} — ${t(sportPreset.labelKey as any)} (${ev.playerCount}/${ev.maxPlayers})`;
    return `marker=${ev.lat},${ev.lng},${encodeURIComponent(label)}`;
  });

  // Use an OpenStreetMap embed with markers via a data URI with Leaflet
  const html = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"><\/script>
<style>html,body,#map{margin:0;padding:0;width:100%;height:100%}</style>
</head><body>
<div id="map"></div>
<script>
var map=L.map('map').setView([${center[0]},${center[1]}],${events.length > 0 ? 10 : 5});
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
  attribution:'&copy; OpenStreetMap contributors',maxZoom:18
}).addTo(map);
${events.map((ev) => {
    const sportPreset = getSportPreset(ev.sport);
    const title = ev.title.replace(/'/g, "\\'").replace(/"/g, "&quot;");
    const sportLabel = t(sportPreset.labelKey as any);
    const joinLabel = t("joinGame");
    const eventUrl = `${origin}/events/${ev.id}`;
    const popupContent = `<b>${title}</b><br/>${sportLabel} — ${ev.playerCount}/${ev.maxPlayers}<br/><a href="#" onclick="window.top.location.href='${eventUrl}';return false;">${joinLabel}</a>`;
    return `L.marker([${ev.lat},${ev.lng}]).addTo(map).bindPopup('${popupContent.replace(/'/g, "\\'")}');`;
  }).join("\n")}
${events.length > 1 ? `map.fitBounds([${events.map((e) => `[${e.lat},${e.lng}]`).join(",")}],{padding:[30,30]});` : ""}
<\/script>
</body></html>`;

  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

// ── Main component ────────────────────────────────────────────────────────────

export default function PublicGamesPage() {
  const t = useT();
  const theme = useTheme();
  const locale = detectLocale();

  // Read initial state from URL params
  const getInitialParams = useCallback(() => {
    if (typeof window === "undefined") return { view: "cards" as ViewMode, sport: "", hasSpots: false };
    const params = new URLSearchParams(window.location.search);
    return {
      view: (params.get("view") as ViewMode) || "cards",
      sport: params.get("sport") || "",
      hasSpots: params.get("hasSpots") === "true",
    };
  }, []);

  const initial = getInitialParams();
  const [viewMode, setViewMode] = useState<ViewMode>(initial.view);
  const [filterSport, setFilterSport] = useState(initial.sport);
  const [filterHasSpots, setFilterHasSpots] = useState(initial.hasSpots);

  // Sync filters to URL
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams();
    if (viewMode !== "cards") params.set("view", viewMode);
    if (filterSport) params.set("sport", filterSport);
    if (filterHasSpots) params.set("hasSpots", "true");
    const qs = params.toString();
    const newUrl = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
    window.history.replaceState(null, "", newUrl);
  }, [viewMode, filterSport, filterHasSpots]);

  const { data: events, isLoading } = useSWR<PublicEvent[]>(
    "/api/events/public",
    (url) => fetch(url).then((r) => r.json()),
    { refreshInterval: 15000 },
  );

  // Unique sports from data for the filter dropdown
  const availableSports = useMemo(() => {
    if (!events) return [];
    const ids = [...new Set(events.map((e) => e.sport))];
    return ids.map((id) => getSportPreset(id));
  }, [events]);

  // Apply filters
  const filtered = useMemo(() => {
    if (!events) return [];
    return events.filter((ev) => {
      if (filterSport && ev.sport !== filterSport) return false;
      if (filterHasSpots && ev.spotsLeft === 0) return false;
      return true;
    });
  }, [events, filterSport, filterHasSpots]);

  return (
    <ThemeModeProvider>
      <ResponsiveLayout>
        <Container maxWidth="md" sx={{ py: 6 }}>
          <Stack spacing={3}>
            <Box textAlign="center">
              <SportsIcon sx={{ fontSize: 56, color: "primary.main", mb: 1 }} />
              <Typography variant="h4" fontWeight={700}>{t("publicGames")}</Typography>
              <Typography variant="body1" color="text.secondary" mt={1}>
                {t("publicGamesSubtitle")}
              </Typography>
            </Box>

            {/* Filter bar + view toggle */}
            <Paper elevation={1} sx={{ borderRadius: 3, p: 2 }}>
              <Stack
                direction={{ xs: "column", sm: "row" }}
                spacing={2}
                alignItems={{ sm: "center" }}
                justifyContent="space-between"
              >
                <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap">
                  <FormControl size="small" sx={{ minWidth: 160 }}>
                    <InputLabel>{t("filterSport")}</InputLabel>
                    <Select
                      value={filterSport}
                      label={t("filterSport")}
                      onChange={(e) => setFilterSport(e.target.value)}
                    >
                      <MenuItem value="">{t("allSports")}</MenuItem>
                      {availableSports.map((s) => (
                        <MenuItem key={s.id} value={s.id}>{t(s.labelKey as any)}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  <FormControlLabel
                    control={
                      <Switch
                        size="small"
                        checked={filterHasSpots}
                        onChange={(e) => setFilterHasSpots(e.target.checked)}
                      />
                    }
                    label={<Typography variant="body2">{t("filterHasSpots")}</Typography>}
                  />
                </Stack>
                <ToggleButtonGroup
                  value={viewMode}
                  exclusive
                  onChange={(_, v) => v && setViewMode(v)}
                  size="small"
                >
                  <ToggleButton value="cards" aria-label={t("viewCards")}>
                    <GridViewIcon fontSize="small" />
                  </ToggleButton>
                  <ToggleButton value="table" aria-label={t("viewTable")}>
                    <TableRowsIcon fontSize="small" />
                  </ToggleButton>
                  <ToggleButton value="map" aria-label={t("viewMap")}>
                    <MapIcon fontSize="small" />
                  </ToggleButton>
                </ToggleButtonGroup>
              </Stack>
            </Paper>

            {isLoading && (
              <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
                <CircularProgress />
              </Box>
            )}

            {!isLoading && (!events || events.length === 0) && (
              <Paper elevation={2} sx={{ borderRadius: 3, p: 4, textAlign: "center" }}>
                <Typography variant="h6" color="text.secondary" gutterBottom>
                  {t("noPublicGames")}
                </Typography>
                <Typography variant="body2" color="text.secondary" mb={2}>
                  {t("noPublicGamesDesc")}
                </Typography>
                <Button variant="contained" href="/">{t("createGameBtn")}</Button>
              </Paper>
            )}

            {!isLoading && events && events.length > 0 && filtered.length === 0 && (
              <Paper elevation={2} sx={{ borderRadius: 3, p: 4, textAlign: "center" }}>
                <Typography variant="body1" color="text.secondary">
                  {t("noMatchingGames")}
                </Typography>
              </Paper>
            )}

            {!isLoading && filtered.length > 0 && viewMode === "cards" && (
              <CardView events={filtered} locale={locale} t={t} theme={theme} />
            )}

            {!isLoading && filtered.length > 0 && viewMode === "table" && (
              <TableView events={filtered} locale={locale} t={t} />
            )}

            {!isLoading && filtered.length > 0 && viewMode === "map" && (
              <MapView events={filtered} t={t} locale={locale} />
            )}
          </Stack>
        </Container>
      </ResponsiveLayout>
    </ThemeModeProvider>
  );
}
