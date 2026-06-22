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
        delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
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

  // Group by club: merge multiple slots/courts into one entry per club
  interface GroupedClub {
    primary: CourtAlternative; // first sorted entry (cheapest/earliest/closest)
    slots: Array<{ resourceName: string; slotTime: string; price: number | null; currency: string | null; resourceId: string }>;
    hasBooked: boolean;
  }
  const groupedAlternatives: GroupedClub[] = [];
  const clubIndex = new Map<string, number>();
  for (const alt of sortedAlternatives) {
    const existing = clubIndex.get(alt.tenantId);
    if (existing !== undefined) {
      const group = groupedAlternatives[existing];
      group.slots.push({ resourceName: alt.resourceName, slotTime: alt.slotTime, price: alt.price, currency: alt.currency, resourceId: alt.resourceId });
      if (alt.status === "booked") group.hasBooked = true;
    } else {
      clubIndex.set(alt.tenantId, groupedAlternatives.length);
      groupedAlternatives.push({
        primary: alt,
        slots: [{ resourceName: alt.resourceName, slotTime: alt.slotTime, price: alt.price, currency: alt.currency, resourceId: alt.resourceId }],
        hasBooked: alt.status === "booked",
      });
    }
  }

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
                <Typography variant="caption" color="text.secondary">{groupedAlternatives.length} clubs</Typography>
              </Stack>

              {mapView ? (
                <Box sx={{ height: 300, borderRadius: 1, overflow: "hidden", border: 1, borderColor: "divider" }}>
                  <CourtAlternativesMap alternatives={sortedAlternatives} />
                </Box>
              ) : (
                <>
                  <Stack spacing={1.5} divider={<Divider />}>
                    {groupedAlternatives.slice(0, visibleCount).map((group) => {
                  const alt = group.primary;
                  const multiCourt = new Set(group.slots.map((x) => x.resourceId)).size > 1;
                  return (
                  <Box key={alt.tenantId} sx={{ py: 1 }}>
                    <Stack spacing={0.5}>
                      <Stack direction="row" spacing={1} alignItems="center">
                        {alt.imageUrl && (
                          <Avatar src={alt.imageUrl} variant="rounded" sx={{ width: 36, height: 36 }} />
                        )}
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Typography
                            variant="body2" fontWeight={600}
                            component="a" href={alt.playtomicUrl} target="_blank" rel="noopener noreferrer"
                            sx={{ textDecoration: "none", color: "inherit", "&:hover": { textDecoration: "underline" } }}
                          >
                            {alt.tenantName}
                          </Typography>
                          {alt.address && (
                            <Typography variant="caption" color="text.secondary" display="block">
                              {alt.address}{alt.distanceKm !== null && ` · ${alt.distanceKm} km`}
                            </Typography>
                          )}
                        </Box>
                        {/* Notify button for booked clubs */}
                        {group.hasBooked && (
                          watchedResourceIds.has(alt.resourceId) ? (
                            <Chip label={t("courtWatchCreated")} size="small" color="success" icon={<NotificationsActiveIcon />} />
                          ) : (
                            <IconButton
                              size="small"
                              onClick={() => createWatch(alt)}
                              disabled={watchingResourceId === alt.resourceId}
                              title={t("courtNotifyWhenFree")}
                            >
                              {watchingResourceId === alt.resourceId ? <CircularProgress size={16} /> : <NotificationsActiveIcon fontSize="small" />}
                            </IconButton>
                          )
                        )}
                      </Stack>
                      {/* Slot chips — tap to get action menu */}
                      <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                        {group.slots.filter((s) => sortedAlternatives.find((a) => a.tenantId === alt.tenantId && a.resourceId === s.resourceId && a.slotTime === s.slotTime)?.status === "available").map((s) => (
                          <Chip
                            key={`${s.resourceId}-${s.slotTime}`}
                            label={`${s.slotTime}${multiCourt && s.resourceName ? ` · ${s.resourceName}` : ""}${formatPrice(s.price, s.currency) ? ` · ${formatPrice(s.price, s.currency)}` : ""}`}
                            size="small" color="primary" variant="outlined" clickable
                            onClick={() => setSwitchTarget(sortedAlternatives.find((a) => a.tenantId === alt.tenantId && a.resourceId === s.resourceId && a.slotTime === s.slotTime)!)}
                          />
                        ))}
                        {group.hasBooked && (
                          <Chip label={t("courtStatusBooked")} size="small" color="default" variant="filled" />
                        )}
                      </Stack>
                    </Stack>
                  </Box>
                  );
                })}
              </Stack>
              {visibleCount < groupedAlternatives.length && (
                <Button size="small" sx={{ mt: 1 }} onClick={() => setVisibleCount((c) => c + 5)}>
                  {t("courtShowMore")} ({groupedAlternatives.length - visibleCount} more)
                </Button>
              )}
                </>
              )}
            </>
          )}
        </Box>
      </Collapse>

      {/* Slot action dialog — tap a chip to open */}
      <Dialog open={!!switchTarget} onClose={() => setSwitchTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ pb: 1 }}>
          {switchTarget?.tenantName}
          {switchTarget?.resourceName && <Typography variant="caption" display="block" color="text.secondary">{switchTarget.resourceName} · {switchTarget?.slotTime}</Typography>}
        </DialogTitle>
        <DialogContent sx={{ pt: 0 }}>
          <Stack spacing={1.5}>
            <Button
              variant="contained"
              startIcon={<OpenInNewIcon />}
              onClick={() => { window.open(switchTarget?.playtomicUrl, "_blank", "noopener,noreferrer"); setSwitchTarget(null); }}
              fullWidth
            >
              {t("playtomicBookOnPlaytomic")}
            </Button>
            <Button
              variant="outlined"
              startIcon={<SwapHorizIcon />}
              onClick={() => handleSwitch(switchTarget?.slotTime !== gameTime)}
              disabled={switching}
              fullWidth
            >
              {switching ? <CircularProgress size={16} /> : t("courtSwitchButton")}
            </Button>
            {switchTarget && switchTarget.slotTime !== gameTime && (
              <Typography variant="caption" color="text.secondary">
                {t("courtSwitchConfirmTime").replace("{time}", switchTarget.slotTime).replace("{currentTime}", gameTime)}
              </Typography>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSwitchTarget(null)} size="small">{t("cancel")}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

