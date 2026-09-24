import { useState, useMemo, useEffect, useCallback } from "react";
import type * as ReactLeaflet from "react-leaflet";
import type * as Leaflet from "leaflet";
import {
  Container, Paper, Typography, Box, Stack, Chip, Button,
  CircularProgress, Grid, ToggleButtonGroup, ToggleButton,
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
import EventRepeatIcon from "@mui/icons-material/EventRepeat";
import PublicIcon from "@mui/icons-material/Public";
import { ThemeModeProvider } from "./ThemeModeProvider";
import { ResponsiveLayout } from "./ResponsiveLayout";
import { useT } from "~/lib/useT";
import { detectLocale, type TFunction } from "~/lib/i18n";
import { getSportPreset } from "~/lib/sports";
import { formatDateInTz } from "~/lib/timezones";

interface PublicEvent {
  id: string;
  title: string;
  location: string;
  latitude: number | null;
  longitude: number | null;
  sport: string;
  dateTime: string;
  timezone?: string;
  maxPlayers: number;
  playerCount: number;
  spotsLeft: number;
  isRecurring: boolean;
  source?: string;
  ownerId?: string | null;
  playtomicTenantName?: string | null;
}

const isOpenPickup = (ev: PublicEvent): boolean => ev.source === "playtomic" && ev.ownerId === null;

/** Adopt an Open Pickup (ADR-0021): becomes the owner, stays public. */
async function adoptPickup(ev: PublicEvent, t: TFunction) {
  if (!window.confirm(t("claimPickupConfirm"))) return;
  try {
    const res = await fetch(`/api/events/${ev.id}/adopt`, { method: "POST" });
    if (res.status === 401) {
      window.location.href = `/auth/signin?callbackURL=${encodeURIComponent(`/events/${ev.id}`)}`;
      return;
    }
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      alert(body?.error ?? t("claimPickupFailed"));
      return;
    }
    window.location.href = `/events/${ev.id}`;
  } catch {
    alert(t("claimPickupFailed"));
  }
}

interface PaginatedPublicEvents {
  data: PublicEvent[];
  nextCursor: string | null;
  hasMore: boolean;
}

type ViewMode = "cards" | "table" | "map";

// ── Card view ─────────────────────────────────────────────────────────────────

function CardView({ events, locale, t }: {
  events: PublicEvent[];
  locale: string;
  t: TFunction;
}) {
  return (
    <Grid container spacing={2}>
      {events.map((ev) => {
        const date = new Date(ev.dateTime);
        const isFull = ev.spotsLeft === 0;
        const sportPreset = getSportPreset(ev.sport);
        return (
          <Grid key={ev.id} size={{ xs: 12, sm: 6 }}>
            <Paper
              elevation={2}
              sx={{
                borderRadius: 3, p: 3, height: "100%",
                display: "flex", flexDirection: "column", gap: 1.5,
                transition: "transform 0.15s, box-shadow 0.15s",
                "&:hover": { transform: "translateY(-2px)", boxShadow: 6 },
                ...(isOpenPickup(ev) ? { border: "1px dashed", borderColor: "primary.main" } : {}),
              }}
            >
              <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <Typography variant="h6" fontWeight={700} noWrap sx={{ flex: 1 }}>
                  {ev.title}
                </Typography>
                <Box sx={{ display: "flex", gap: 0.5, ml: 1, flexShrink: 0 }}>
                  {isOpenPickup(ev) && (
                    <Chip
                      icon={<PublicIcon />}
                      label={t("openPickupBadge")}
                      size="small"
                      color="primary"
                    />
                  )}
                  <Chip
                    label={t(sportPreset.labelKey as Parameters<typeof t>[0])}
                    size="small"
                    variant="outlined"
                    color="primary"
                  />
                  {ev.isRecurring && (
                    <Chip
                      icon={<EventRepeatIcon />}
                      label={t("recurring")}
                      size="small"
                      variant="outlined"
                      color="secondary"
                    />
                  )}
                </Box>
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
                    {formatDateInTz(date, locale === "pt" ? "pt-PT" : "en-GB", ev.timezone || "UTC", {
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
                {isOpenPickup(ev) ? (
                  <Button
                    variant="contained"
                    fullWidth
                    sx={{ borderRadius: 2 }}
                    onClick={() => void adoptPickup(ev, t)}
                  >
                    {t("claimPickup")}
                  </Button>
                ) : (
                  <Button
                    variant="contained"
                    fullWidth
                    href={`/events/${ev.id}`}
                    sx={{ borderRadius: 2 }}
                  >
                    {t("joinGame")}
                  </Button>
                )}
              </Box>
            </Paper>
          </Grid>
        );
      })}
    </Grid>
  );
}

// ── Table view ────────────────────────────────────────────────────────────────

function TableView({ events, locale, t }: {
  events: PublicEvent[];
  locale: string;
  t: TFunction;
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
            <TableCell sx={{ fontWeight: 700 }}>{t("tableType")}</TableCell>
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
                    {t(sportPreset.labelKey as Parameters<typeof t>[0])}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="body2" color="text.secondary" noWrap>
                    {ev.location || "—"}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="body2" color="text.secondary" noWrap>
                    {formatDateInTz(date, locale === "pt" ? "pt-PT" : "en-GB", ev.timezone || "UTC", {
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
                  {isOpenPickup(ev) ? (
                    <Chip icon={<PublicIcon />} label={t("openPickupBadge")} size="small" color="primary" />
                  ) : ev.isRecurring ? (
                    <Chip icon={<EventRepeatIcon />} label={t("recurring")} size="small" color="secondary" variant="outlined" />
                  ) : (
                    <Typography variant="body2" color="text.secondary">{t("oneOff")}</Typography>
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

// ── Map view (bundled Leaflet — no CDN, so it works under the app CSP) ─────────

interface GeoEvent extends PublicEvent {
  lat: number;
  lng: number;
}

interface LeafletBundle {
  MapContainer: typeof ReactLeaflet.MapContainer;
  TileLayer: typeof ReactLeaflet.TileLayer;
  Marker: typeof ReactLeaflet.Marker;
  Popup: typeof ReactLeaflet.Popup;
  divIcon: typeof Leaflet.divIcon;
}

function MapView({ events, t }: {
  events: PublicEvent[];
  t: TFunction;
}) {
  const [bundle, setBundle] = useState<LeafletBundle | null>(null);

  // Lazy-load Leaflet + its CSS through the bundler so scripts/styles are served
  // from 'self'. (The previous srcdoc iframe pulled Leaflet from unpkg, which the
  // app CSP forbids — and a srcdoc document inherits the parent CSP, so the map
  // silently never loaded.)
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      import("react-leaflet"),
      import("leaflet"),
      import("leaflet/dist/leaflet.css"),
    ]).then(([rl, L]) => {
      if (cancelled) return;
      setBundle({
        MapContainer: rl.MapContainer,
        TileLayer: rl.TileLayer,
        Marker: rl.Marker,
        Popup: rl.Popup,
        divIcon: L.divIcon,
      });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Use stored coordinates — no client-side geocoding needed
  const geoEvents: GeoEvent[] = useMemo(() =>
    events
      .filter((ev) => ev.latitude !== null && ev.longitude !== null)
      .map((ev) => ({ ...ev, lat: ev.latitude ?? 0, lng: ev.longitude ?? 0 })),
    [events],
  );

  // Centre on the average of the pins so every game is roughly in frame.
  const center: [number, number] = geoEvents.length > 0
    ? [
        geoEvents.reduce((s, e) => s + e.lat, 0) / geoEvents.length,
        geoEvents.reduce((s, e) => s + e.lng, 0) / geoEvents.length,
      ]
    : [41.15, -8.63];

  // A divIcon pin — no image assets, so nothing can be blocked by img-src.
  const pinIcon = useMemo(() => {
    if (!bundle) return null;
    return bundle.divIcon({
      className: "",
      html: '<div style="width:16px;height:16px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:#1b6b4a;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>',
      iconSize: [16, 16],
      iconAnchor: [8, 16],
      popupAnchor: [0, -16],
    });
  }, [bundle]);

  return (
    <Stack spacing={1}>
      <Paper elevation={2} sx={{ borderRadius: 3, overflow: "hidden", height: 450 }}>
        {bundle && pinIcon ? (
          <bundle.MapContainer
            center={center}
            zoom={geoEvents.length > 0 ? 12 : 6}
            style={{ height: "100%", width: "100%" }}
            scrollWheelZoom
          >
            <bundle.TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            />
            {geoEvents.map((ev) => {
              const sportPreset = getSportPreset(ev.sport);
              return (
                <bundle.Marker key={ev.id} position={[ev.lat, ev.lng]} icon={pinIcon}>
                  <bundle.Popup>
                    <strong>{ev.title}</strong><br />
                    {t(sportPreset.labelKey as Parameters<typeof t>[0])} — {ev.playerCount}/{ev.maxPlayers}<br />
                    {ev.location ? <>{ev.location}<br /></> : null}
                    <a href={`/events/${ev.id}`}>{t("joinGame")}</a>
                  </bundle.Popup>
                </bundle.Marker>
              );
            })}
          </bundle.MapContainer>
        ) : (
          <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100%" }}>
            <CircularProgress />
          </Box>
        )}
      </Paper>
      {geoEvents.length === 0 && (
        <Alert severity="warning" sx={{ borderRadius: 2 }}>
          {t("mapNoLocation")}
        </Alert>
      )}
    </Stack>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function PublicGamesPage() {
  const t = useT();
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
  const [filterType, setFilterType] = useState<"" | "recurring" | "oneoff">("");

  // Sync filters to URL
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams();
    if (viewMode !== "cards") params.set("view", viewMode);
    if (filterSport) params.set("sport", filterSport);
    if (filterHasSpots) params.set("hasSpots", "true");
    if (filterType) params.set("type", filterType);
    const qs = params.toString();
    const newUrl = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
    window.history.replaceState(null, "", newUrl);
  }, [viewMode, filterSport, filterHasSpots, filterType]);

  const [events, setEvents] = useState<PublicEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const fetchPage = useCallback(async (cursor?: string | null) => {
    const params = new URLSearchParams();
    if (cursor) params.set("cursor", cursor);
    const res = await fetch(`/api/events/public?${params.toString()}`);
    return (await res.json()) as PaginatedPublicEvents;
  }, []);

  useEffect(() => {
    fetchPage().then((page) => {
      setEvents(page.data);
      setNextCursor(page.nextCursor);
      setHasMore(page.hasMore);
      setIsLoading(false);
    });
  }, [fetchPage]);

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    const page = await fetchPage(nextCursor);
    setEvents((prev) => [...prev, ...page.data]);
    setNextCursor(page.nextCursor);
    setHasMore(page.hasMore);
    setLoadingMore(false);
  };

  // Unique sports from data for the filter dropdown
  const availableSports = useMemo(() => {
    if (events.length === 0) return [];
    const ids = [...new Set(events.map((e) => e.sport))];
    return ids.map((id) => getSportPreset(id));
  }, [events]);

  // Apply filters
  const filtered = useMemo(() => {
    return events.filter((ev) => {
      if (filterSport && ev.sport !== filterSport) return false;
      if (filterHasSpots && ev.spotsLeft === 0) return false;
      if (filterType === "recurring" && !ev.isRecurring) return false;
      if (filterType === "oneoff" && ev.isRecurring) return false;
      return true;
    });
  }, [events, filterSport, filterHasSpots, filterType]);

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
                        <MenuItem key={s.id} value={s.id}>{t(s.labelKey as Parameters<typeof t>[0])}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  <FormControl size="small" sx={{ minWidth: 140 }}>
                    <InputLabel>{t("filterType")}</InputLabel>
                    <Select
                      value={filterType}
                      label={t("filterType")}
                      onChange={(e) => setFilterType(e.target.value as "" | "recurring" | "oneoff")}
                    >
                      <MenuItem value="">{t("allTypes")}</MenuItem>
                      <MenuItem value="recurring">{t("recurring")}</MenuItem>
                      <MenuItem value="oneoff">{t("oneOff")}</MenuItem>
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

            {!isLoading && events.length === 0 && (
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

            {!isLoading && events.length > 0 && filtered.length === 0 && (
              <Paper elevation={2} sx={{ borderRadius: 3, p: 4, textAlign: "center" }}>
                <Typography variant="body1" color="text.secondary">
                  {t("noMatchingGames")}
                </Typography>
              </Paper>
            )}

            {!isLoading && filtered.length > 0 && viewMode === "cards" && (
              <CardView events={filtered} locale={locale} t={t} />
            )}

            {!isLoading && filtered.length > 0 && viewMode === "table" && (
              <TableView events={filtered} locale={locale} t={t} />
            )}

            {!isLoading && filtered.length > 0 && viewMode === "map" && (
              <MapView events={filtered} t={t} />
            )}

            {!isLoading && hasMore && (
              <Box sx={{ display: "flex", justifyContent: "center", pt: 2 }}>
                <Button
                  variant="outlined"
                  onClick={loadMore}
                  disabled={loadingMore}
                >
                  {loadingMore ? t("loading") : t("loadMore")}
                </Button>
              </Box>
            )}
          </Stack>
        </Container>
      </ResponsiveLayout>
    </ThemeModeProvider>
  );
}
