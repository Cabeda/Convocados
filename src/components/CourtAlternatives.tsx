import React, { useState, useCallback } from "react";
import {
  Box, Button, Typography, Stack, Chip, Alert, CircularProgress,
  Switch, FormControlLabel, Slider, ToggleButtonGroup, ToggleButton,
  Card, CardContent, Divider, Dialog, DialogTitle, DialogContent, DialogActions,
  IconButton,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import SwapHorizIcon from "@mui/icons-material/SwapHoriz";
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
}

interface Props {
  eventId: string;
  hasCoordinates: boolean;
  courtWatchConfig: { radius: number; indoor: boolean | null; surface: string | null } | null;
  gameTime: string; // "HH:mm"
}

export default function CourtAlternatives({ eventId, hasCoordinates, courtWatchConfig, gameTime }: Props) {
  const t = useT();
  const [loading, setLoading] = useState(false);
  const [alternatives, setAlternatives] = useState<CourtAlternative[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  // Watch config state
  const [watchEnabled, setWatchEnabled] = useState(!!courtWatchConfig);
  const [radius, setRadius] = useState(courtWatchConfig?.radius ?? 10000);
  const [indoor, setIndoor] = useState<string>(
    courtWatchConfig?.indoor === true ? "indoor" : courtWatchConfig?.indoor === false ? "outdoor" : "any",
  );

  // Switch dialog
  const [switchTarget, setSwitchTarget] = useState<CourtAlternative | null>(null);
  const [switching, setSwitching] = useState(false);

  const searchAlternatives = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSearched(true);
    try {
      const params = new URLSearchParams({ radius: String(radius) });
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
  }, [eventId, radius, indoor, t]);

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
        latitude: undefined,
        longitude: undefined,
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

  const formatPrice = (price: number, currency: string) =>
    new Intl.NumberFormat(undefined, { style: "currency", currency }).format(price);

  if (!hasCoordinates) {
    return (
      <Alert severity="info" sx={{ mt: 2 }}>{t("courtWatchNeedsCoords")}</Alert>
    );
  }

  return (
    <Card variant="outlined" sx={{ mt: 2 }}>
      <CardContent>
        <Typography variant="h6" gutterBottom>{t("courtAlternatives")}</Typography>
        <Typography variant="body2" color="text.secondary" gutterBottom>{t("courtAlternativesDesc")}</Typography>

        {/* Filters */}
        <Stack spacing={2} sx={{ my: 2 }}>
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

        {/* Results */}
        {searched && !loading && alternatives.length === 0 && !error && (
          <Alert severity="info">{t("courtAlternativesNone")}</Alert>
        )}

        {alternatives.length > 0 && (
          <Stack spacing={1} divider={<Divider />}>
            {alternatives.map((alt) => (
              <Box key={`${alt.tenantId}-${alt.resourceId}-${alt.slotTime}`} sx={{ py: 1 }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Box>
                    <Typography variant="body2" fontWeight={600}>{alt.tenantName}</Typography>
                    <Typography variant="caption" color="text.secondary">{alt.resourceName} — {alt.address}</Typography>
                    <Stack direction="row" spacing={0.5} sx={{ mt: 0.5 }}>
                      <Chip label={alt.slotTime} size="small" color="primary" variant="outlined" />
                      <Chip label={`${alt.duration}min`} size="small" variant="outlined" />
                      <Chip label={formatPrice(alt.price, alt.currency)} size="small" color="success" variant="outlined" />
                    </Stack>
                  </Box>
                  <Stack direction="row" spacing={0.5}>
                    <IconButton size="small" href={alt.playtomicUrl} target="_blank" rel="noopener noreferrer">
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
        )}
      </CardContent>

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
          <Button onClick={() => setSwitchTarget(null)} disabled={switching}>{t("courtSwitchConfirmTimeNo")}</Button>
          {switchTarget && switchTarget.slotTime !== gameTime && (
            <Button onClick={() => handleSwitch(true)} disabled={switching} variant="contained">{t("courtSwitchConfirmTimeYes")}</Button>
          )}
          <Button onClick={() => handleSwitch(false)} disabled={switching} variant={switchTarget?.slotTime === gameTime ? "contained" : "outlined"}>
            {switchTarget?.slotTime === gameTime ? t("courtSwitchButton") : t("courtSwitchConfirmTimeNo")}
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}
