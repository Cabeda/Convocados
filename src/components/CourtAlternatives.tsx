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
import { useT } from "~/lib/useT";

interface CourtAlternative {
  tenantId: string;
  tenantName: string;
  resourceId: string;
  resourceName: string;
  slotTime: string;
  slotDate: string;
  duration: number;
  price: number;
  currency: string;
  address: string | null;
  playtomicUrl: string;
  imageUrl: string | null;
  distanceKm: number | null;
}

interface Props {
  eventId: string;
  hasCoordinates: boolean;
  courtWatchConfig: { radius: number; indoor: boolean | null; surface: string | null } | null;
  gameTime: string; // "HH:mm"
}

type SortOption = "price" | "time" | "distance";

export default function CourtAlternatives({ eventId, hasCoordinates, courtWatchConfig, gameTime }: Props) {
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
    const [h, m] = gameTime.split(":").map(Number);
    const start = Math.max(0, h * 60 + m - 60);
    return `${String(Math.floor(start / 60)).padStart(2, "0")}:${String(start % 60).padStart(2, "0")}`;
  });
  const [endTime, setEndTime] = useState(() => {
    const [h, m] = gameTime.split(":").map(Number);
    const end = Math.min(23 * 60 + 59, h * 60 + m + 60);
    return `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`;
  });
  const [sortBy, setSortBy] = useState<SortOption>("price");

  // Watch config
  const [watchEnabled, setWatchEnabled] = useState(!!courtWatchConfig);

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

      const res = await fetch(`/api/events/${eventId}/court-alternatives?${params}`);
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? t("courtAlternativesError")); return; }
      setAlternatives(data.alternatives ?? []);
    } catch {
      setError(t("courtAlternativesError"));
    } finally {
      setLoading(false);
    }
  }, [eventId, radius, indoor, startTime, endTime, t]);

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

  const sortedAlternatives = [...alternatives].sort((a, b) => {
    if (sortBy === "price") return a.price - b.price;
    if (sortBy === "time") return a.slotTime.localeCompare(b.slotTime);
    if (sortBy === "distance") return (a.distanceKm ?? 999) - (b.distanceKm ?? 999);
    return 0;
  });

  const formatPrice = (price: number, currency: string) =>
    new Intl.NumberFormat(undefined, { style: "currency", currency }).format(price);

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
              </Stack>

              <Stack spacing={1} divider={<Divider />}>
                {sortedAlternatives.map((alt) => (
                  <Box key={`${alt.tenantId}-${alt.resourceId}-${alt.slotTime}`} sx={{ py: 1 }}>
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
                        <Stack direction="row" spacing={0.5} sx={{ mt: 0.5 }}>
                          <Chip label={alt.slotTime} size="small" color="primary" variant="outlined" />
                          <Chip label={`${alt.duration}min`} size="small" variant="outlined" />
                          <Chip label={formatPrice(alt.price, alt.currency)} size="small" color="success" variant="outlined" />
                        </Stack>
                      </Box>
                      <Stack direction="row" spacing={0.5} alignItems="center">
                        <IconButton size="small" href={alt.playtomicUrl} target="_blank" rel="noopener noreferrer" title={t("playtomicBookOnPlaytomic")}>
                          <OpenInNewIcon fontSize="small" />
                        </IconButton>
                        <Button size="small" variant="outlined" startIcon={<SwapHorizIcon />} onClick={() => setSwitchTarget(alt)}>
                          {t("courtSwitchButton")}
                        </Button>
                      </Stack>
                    </Stack>
                  </Box>
                ))}
              </Stack>
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
