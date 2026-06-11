import React, { useState, useCallback } from "react";
import {
  Box, Button, Typography, Stack, Chip, Alert, CircularProgress,
  Switch, FormControlLabel, Slider, ToggleButtonGroup, ToggleButton,
  Divider, Dialog, DialogTitle, DialogContent, DialogActions,
  IconButton, Collapse, Avatar, TextField, MenuItem, Select,
  type SelectChangeEvent,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import SwapHorizIcon from "@mui/icons-material/SwapHoriz";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import PlaceIcon from "@mui/icons-material/Place";
import SortIcon from "@mui/icons-material/Sort";
import NotificationsActiveIcon from "@mui/icons-material/NotificationsActive";
import MapIcon from "@mui/icons-material/Map";
import ListIcon from "@mui/icons-material/ViewList";
import { useT } from "~/lib/useT";

interface CourtAlternative {
  tenantId: string;
  tenantName: string;
  resourceId: string;
  resourceName: string;
  slotTime: string;
  slotDate: string;
  duration: number;
  price: number | null;
  currency: string | null;
  address: string | null;
  playtomicUrl: string;
  imageUrl: string | null;
  distanceKm: number | null;
  coordinate: { lat: number; lon: number } | null;
  status: "available" | "booked";
}

interface Props {
  eventId: string;
  sport: string;
  hasCoordinates: boolean;
  courtWatchConfig: { radius: number; indoor: boolean | null; surface: string | null } | null;
  gameTime: string; // "HH:mm"
}

type SortOption = "price" | "time" | "distance";

// ── Map sub-component (lazy: only loaded when map view is toggled) ─────────────

function CourtAlternativesMap({ alternatives }: { alternatives: CourtAlternative[] }) {
  // eslint-disable-next-line @eslint-react/static-components
  const [loaded, setLoaded] = React.useState(false);
  const ref = React.useRef<{
    MapContainer: typeof import("react-leaflet").MapContainer;
    TileLayer: typeof import("react-leaflet").TileLayer;
    Marker: typeof import("react-leaflet").Marker;
    Popup: typeof import("react-leaflet").Popup;
  } | null>(null);

  React.useEffect(() => {
    if (ref.current) return;
    Promise.all([import("react-leaflet"), import("leaflet"), import("leaflet/dist/leaflet.css")] as const).then(
      ([rl, L]) => {
        delete (L.Icon.Default.prototype as L.Icon.Default & { _getIconUrl?: unknown })._getIconUrl;
        L.Icon.Default.mergeOptions({
          iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
          iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
          shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
        });
        ref.current = { MapContainer: rl.MapContainer, TileLayer: rl.TileLayer, Marker: rl.Marker, Popup: rl.Popup };
        setLoaded(true);
      },
    );
  }, []);

  if (!loaded || !ref.current) return <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}><CircularProgress size={24} /></Box>;

  const { MapContainer, TileLayer, Marker, Popup } = ref.current;
  const markers = alternatives.filter((a) => a.coordinate);
  const center: [number, number] = markers.length > 0
    ? [markers[0].coordinate!.lat, markers[0].coordinate!.lon]
    : [41.15, -8.63];

  const unique = new Map<string, CourtAlternative>();
  for (const m of markers) {
    const k = `${m.coordinate!.lat},${m.coordinate!.lon}`;
    if (!unique.has(k)) unique.set(k, m);
  }

  return (
    <MapContainer center={center} zoom={12} style={{ height: "100%", width: "100%" }} scrollWheelZoom={false}>
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>' />
      {[...unique.values()].map((alt) => (
        <Marker key={`${alt.coordinate!.lat}-${alt.coordinate!.lon}`} position={[alt.coordinate!.lat, alt.coordinate!.lon]}>
          <Popup>
            <strong>{alt.tenantName}</strong><br />
            {alt.resourceName} · {alt.slotTime}<br />
            {alt.status === "booked" ? "Booked" : alt.price !== null ? `${alt.price} ${alt.currency}` : ""}
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function CourtAlternatives({ eventId, sport, hasCoordinates, courtWatchConfig, gameTime }: Props) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [alternatives, setAlternatives] = useState<CourtAlternative[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  // Filters
  const [radius, setRadius] = useState(courtWatchConfig?.radius ?? 10000);
  const [indoor, setIndoor] = useState<string>(
    courtWatchConfig?.indoor === true ? "indoor" : courtWatchConfig?.indoor === false ? "outdoor" : "any",
  );
  const [startTime, setStartTime] = useState(() => {
    // Default: from game time onward
    return gameTime;
  });
  const [endTime, setEndTime] = useState(() => {
    const [h, m] = gameTime.split(":").map(Number);
    const end = Math.min(23 * 60 + 59, h * 60 + m + 120);
    return `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`;
  });
  const [sortBy, setSortBy] = useState<SortOption>("price");
  const [includeBooked, setIncludeBooked] = useState(false);
  const [visibleCount, setVisibleCount] = useState(5);
  const [mapView, setMapView] = useState(false);

  // Watch config
  const [watchEnabled, setWatchEnabled] = useState(!!courtWatchConfig);

  // Notify-when-free (standalone court watch) state
  const [watchingResourceId, setWatchingResourceId] = useState<string | null>(null);
  const [watchedResourceIds, setWatchedResourceIds] = useState<Set<string>>(new Set());

  // Switch dialog
  const [switchTarget, setSwitchTarget] = useState<CourtAlternative | null>(null);
  const [switching, setSwitching] = useState(false);

  const searchAlternatives = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSearched(true);
    try {
      const params = new URLSearchParams({ radius: String(radius), startTime, endTime });
      if (indoor === "indoor") params.set("indoor", "true");
      else if (indoor === "outdoor") params.set("indoor", "false");
      if (includeBooked) params.set("includeBooked", "true");

      const res = await fetch(`/api/events/${eventId}/court-alternatives?${params}`);
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? t("courtAlternativesError")); return; }
      setAlternatives(data.alternatives ?? []);
    } catch {
      setError(t("courtAlternativesError"));
    } finally {
      setLoading(false);
    }
  }, [eventId, radius, indoor, startTime, endTime, includeBooked, t]);

  const toggleWatch = useCallback(async (enabled: boolean) => {
    try {
      const res = await fetch(`/api/events/${eventId}/court-alternatives`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(enabled ? { enabled: true, radius, indoor: indoor === "indoor" ? true : indoor === "outdoor" ? false : null } : { enabled: false }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error); return; }
      setWatchEnabled(enabled);
    } catch {
      setError(t("courtAlternativesError"));
    }
  }, [eventId, radius, indoor, t]);

  const handleSwitch = useCallback(async (adjustTime: boolean) => {
    if (!switchTarget) return;
    setSwitching(true);
    try {
      const body: Record<string, unknown> = {
        location: `${switchTarget.tenantName}, ${switchTarget.address ?? ""}`.trim(),
      };
      if (adjustTime) {
        body.dateTime = `${switchTarget.slotDate}T${switchTarget.slotTime}:00`;
      }
      const res = await fetch(`/api/events/${eventId}/switch-court`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setSwitchTarget(null);
        window.location.reload();
      }
    } finally {
      setSwitching(false);
    }
  }, [eventId, switchTarget]);

  const createWatch = useCallback(async (alt: CourtAlternative) => {
    setWatchingResourceId(alt.resourceId);
    try {
      // dayOfWeek derived from the searched date (event's date)
      const dayOfWeek = new Date(`${alt.slotDate}T00:00:00Z`).getUTCDay();
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
      const res = await fetch(`/api/court-watches`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sport,
          tenantId: alt.tenantId,
          tenantName: alt.tenantName,
          resourceId: alt.resourceId,
          resourceName: alt.resourceName,
          dayOfWeek,
          startTime,
          endTime,
          timezone,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? t("courtAlternativesError"));
        return;
      }
      setWatchedResourceIds((prev) => new Set(prev).add(alt.resourceId));
    } catch {
      setError(t("courtAlternativesError"));
    } finally {
      setWatchingResourceId(null);
    }
  }, [sport, startTime, endTime, t]);

  const sortedAlternatives = [...alternatives].sort((a, b) => {
    if (sortBy === "price") return (a.price ?? Infinity) - (b.price ?? Infinity);
    if (sortBy === "time") return a.slotTime.localeCompare(b.slotTime);
    if (sortBy === "distance") return (a.distanceKm ?? 999) - (b.distanceKm ?? 999);
    return 0;
  });

  const formatPrice = (price: number | null, currency: string | null) =>
    price !== null && price !== undefined && !isNaN(price) && currency
      ? new Intl.NumberFormat(undefined, { style: "currency", currency }).format(price)
      : null;

  if (!hasCoordinates) {
    return (
      <Alert severity="info" sx={{ mt: 2 }}>{t("courtWatchNeedsCoords")}</Alert>
    );
  }

  return (
    <Box sx={{ mt: 2 }}>
      {/* Collapsed state: just a button */}
      <Button
        variant="outlined"
        size="small"
        startIcon={expanded ? <ExpandLessIcon /> : <SearchIcon />}
        onClick={() => setExpanded(!expanded)}
      >
        {t("courtAlternatives")}
      </Button>

      <Collapse in={expanded}>
        <Box sx={{ mt: 2, p: 2, border: 1, borderColor: "divider", borderRadius: 1 }}>
          <Typography variant="body2" color="text.secondary" gutterBottom>{t("courtAlternativesDesc")}</Typography>

          {/* Filters */}
          <Stack spacing={2} sx={{ my: 2 }}>
            {/* Time range */}
            <Stack direction="row" spacing={1} alignItems="center">
              <TextField
                label={t("courtFilterTimeFrom")}
                type="time"
                size="small"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
                sx={{ width: 130 }}
              />
              <Typography variant="body2">–</Typography>
              <TextField
                label={t("courtFilterTimeTo")}
                type="time"
                size="small"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
                sx={{ width: 130 }}
              />
            </Stack>

            <Box>
              <Typography variant="caption">{t("courtFilterRadius")}: {radius / 1000}km</Typography>
              <Slider value={radius} onChange={(_, v) => setRadius(v as number)} min={1000} max={30000} step={1000} valueLabelDisplay="auto" valueLabelFormat={(v) => `${v / 1000}km`} size="small" />
            </Box>

            <ToggleButtonGroup value={indoor} exclusive onChange={(_, v) => v && setIndoor(v)} size="small">
              <ToggleButton value="any">Any</ToggleButton>
              <ToggleButton value="indoor">{t("courtFilterIndoor")}</ToggleButton>
              <ToggleButton value="outdoor">{t("courtFilterOutdoor")}</ToggleButton>
            </ToggleButtonGroup>

            <FormControlLabel
              control={<Switch checked={includeBooked} onChange={(_, checked) => setIncludeBooked(checked)} size="small" />}
              label={<Typography variant="body2">{t("courtIncludeBooked")}</Typography>}
            />
          </Stack>

          {/* Actions */}
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
            <Button variant="contained" size="small" startIcon={loading ? <CircularProgress size={16} color="inherit" /> : <SearchIcon />} onClick={searchAlternatives} disabled={loading}>
              {loading ? t("courtAlternativesSearching") : t("courtAlternativesSearch")}
            </Button>
            <FormControlLabel
              control={<Switch checked={watchEnabled} onChange={(_, checked) => toggleWatch(checked)} size="small" />}
              label={<Typography variant="body2">{watchEnabled ? t("courtWatchEnabled") : t("courtWatchEnable")}</Typography>}
            />
          </Stack>

          {error && <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert>}

          {/* Sort + results */}
          {searched && !loading && alternatives.length === 0 && !error && (
            <Alert severity="info">{t("courtAlternativesNone")}</Alert>
          )}

          {alternatives.length > 0 && (
            <>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                <SortIcon fontSize="small" color="action" />
                <Select
                  value={sortBy}
                  onChange={(e: SelectChangeEvent) => setSortBy(e.target.value as SortOption)}
                  size="small"
                  variant="standard"
                >
                  <MenuItem value="price">{t("courtSortPrice")}</MenuItem>
                  <MenuItem value="time">{t("courtSortTime")}</MenuItem>
                  <MenuItem value="distance">{t("courtSortDistance")}</MenuItem>
                </Select>
                <Box sx={{ flex: 1 }} />
                <IconButton size="small" onClick={() => setMapView(!mapView)} title={mapView ? "List" : "Map"}>
                  {mapView ? <ListIcon fontSize="small" /> : <MapIcon fontSize="small" />}
                </IconButton>
                <Typography variant="caption" color="text.secondary">{sortedAlternatives.length} {t("courtAlternativesSearch").toLowerCase()}</Typography>
              </Stack>

              {mapView ? (
                <Box sx={{ height: 300, borderRadius: 1, overflow: "hidden", border: 1, borderColor: "divider" }}>
                  <CourtAlternativesMap alternatives={sortedAlternatives} />
                </Box>
              ) : (
                <>
                  <Stack spacing={1} divider={<Divider />}>
                    {sortedAlternatives.slice(0, visibleCount).map((alt) => (
                  <Box key={`${alt.tenantId}-${alt.resourceId}-${alt.slotTime}`} sx={{ py: 1, opacity: alt.status === "booked" ? 0.7 : 1 }}>
                    <Stack direction="row" spacing={1.5} alignItems="flex-start">
                      {/* Court photo */}
                      {alt.imageUrl && (
                        <Avatar
                          src={alt.imageUrl}
                          variant="rounded"
                          sx={{ width: 48, height: 48 }}
                        />
                      )}
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="body2" fontWeight={600}>{alt.tenantName}</Typography>
                        <Typography variant="caption" color="text.secondary">{alt.resourceName}</Typography>
                        {alt.address && (
                          <Stack direction="row" spacing={0.5} alignItems="center">
                            <PlaceIcon sx={{ fontSize: 12, color: "text.secondary" }} />
                            <Typography variant="caption" color="text.secondary">
                              {alt.address}
                              {alt.distanceKm !== null && ` · ${alt.distanceKm} km`}
                            </Typography>
                          </Stack>
                        )}
                        <Stack direction="row" spacing={0.5} sx={{ mt: 0.5 }} flexWrap="wrap" useFlexGap>
                          {alt.status === "booked" ? (
                            <Chip label={t("courtStatusBooked")} size="small" color="default" variant="filled" />
                          ) : (
                            <Chip label={alt.slotTime} size="small" color="primary" variant="outlined" />
                          )}
                          <Chip label={`${alt.duration}min`} size="small" variant="outlined" />
                          {formatPrice(alt.price, alt.currency) && (
                            <Chip label={formatPrice(alt.price, alt.currency)} size="small" color="success" variant="outlined" />
                          )}
                        </Stack>
                      </Box>
                      <Stack direction="row" spacing={0.5} alignItems="center">
                        <IconButton size="small" href={alt.playtomicUrl} target="_blank" rel="noopener noreferrer" title={t("playtomicBookOnPlaytomic")}>
                          <OpenInNewIcon fontSize="small" />
                        </IconButton>
                        {alt.status === "booked" ? (
                          watchedResourceIds.has(alt.resourceId) ? (
                            <Chip label={t("courtWatchCreated")} size="small" color="success" icon={<NotificationsActiveIcon />} />
                          ) : (
                            <Button
                              size="small"
                              variant="outlined"
                              startIcon={watchingResourceId === alt.resourceId ? <CircularProgress size={14} /> : <NotificationsActiveIcon />}
                              onClick={() => createWatch(alt)}
                              disabled={watchingResourceId === alt.resourceId}
                            >
                              {t("courtNotifyWhenFree")}
                            </Button>
                          )
                        ) : (
                          <Button size="small" variant="outlined" startIcon={<SwapHorizIcon />} onClick={() => setSwitchTarget(alt)}>
                            {t("courtSwitchButton")}
                          </Button>
                        )}
                      </Stack>
                    </Stack>
                  </Box>
                ))}
              </Stack>
              {visibleCount < sortedAlternatives.length && (
                <Button size="small" sx={{ mt: 1 }} onClick={() => setVisibleCount((c) => c + 5)}>
                  {t("courtShowMore")} ({sortedAlternatives.length - visibleCount} more)
                </Button>
              )}
                </>
              )}
            </>
          )}
        </Box>
      </Collapse>

      {/* Switch confirmation dialog */}
      <Dialog open={!!switchTarget} onClose={() => setSwitchTarget(null)}>
        <DialogTitle>{t("courtSwitchButton")}</DialogTitle>
        <DialogContent>
          {switchTarget && switchTarget.slotTime !== gameTime && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              {t("courtSwitchConfirmTime").replace("{time}", switchTarget.slotTime).replace("{currentTime}", gameTime)}
            </Alert>
          )}
          <Typography>{switchTarget?.tenantName} — {switchTarget?.resourceName}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSwitchTarget(null)} disabled={switching}>{t("cancel")}</Button>
          {switchTarget && switchTarget.slotTime !== gameTime && (
            <Button onClick={() => handleSwitch(true)} disabled={switching} variant="contained">{t("courtSwitchConfirmTimeYes")}</Button>
          )}
          <Button onClick={() => handleSwitch(false)} disabled={switching} variant={switchTarget?.slotTime === gameTime ? "contained" : "outlined"}>
            {switchTarget?.slotTime === gameTime ? t("courtSwitchButton") : t("courtSwitchConfirmTimeNo")}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

