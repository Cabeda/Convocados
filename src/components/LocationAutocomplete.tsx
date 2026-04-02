import React, { useState, useRef, useCallback, lazy, Suspense } from "react";
import {
  TextField, Box, Paper, List, ListItemButton, ListItemText,
  CircularProgress, InputAdornment, IconButton, Tooltip, Dialog,
  DialogTitle, DialogContent, DialogActions, Button, Typography,
} from "@mui/material";
import LocationOnIcon from "@mui/icons-material/LocationOn";
import MapIcon from "@mui/icons-material/Map";
import CloseIcon from "@mui/icons-material/Close";
import MyLocationIcon from "@mui/icons-material/MyLocation";
import { useT } from "~/lib/useT";

// Lazy-load the map to avoid Leaflet's `window` access during SSR
const LeafletMap = lazy(() => import("./LeafletMap"));

interface Suggestion {
  label: string;
  lat: number;
  lon: number;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  coordinate?: { lat: number; lon: number };
  label?: string;
  placeholder?: string;
  fullWidth?: boolean;
  size?: "small" | "medium";
  inputProps?: Record<string, unknown>;
}

const PHOTON_URL =
  (import.meta as any).env?.PUBLIC_PHOTON_URL ?? "https://photon.komoot.io";

const NOMINATIM_URL =
  (import.meta as any).env?.PUBLIC_NOMINATIM_URL ?? "https://nominatim.openstreetmap.org";

async function fetchSuggestionsFromPhoton(query: string): Promise<Suggestion[]> {
  if (query.length < 2) return [];
  try {
    const res = await fetch(
      `${PHOTON_URL}/api/?q=${encodeURIComponent(query)}&limit=5&lang=en`,
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data.features ?? []).map((f: any) => {
      const p = f.properties;
      const parts = [p.name, p.street, p.city, p.country].filter(Boolean);
      return {
        label: parts.join(", "),
        lat: f.geometry.coordinates[1],
        lon: f.geometry.coordinates[0],
      };
    });
  } catch {
    return [];
  }
}

export async function reverseGeocode(lat: number, lon: number): Promise<string> {
  try {
    const res = await fetch(
      `${NOMINATIM_URL}/reverse?lat=${lat}&lon=${lon}&format=json`,
      { headers: { "Accept-Language": "en", "User-Agent": "Convocados/1.0" } },
    );
    if (!res.ok) return `${lat.toFixed(6)},${lon.toFixed(6)}`;
    const data = await res.json();
    return data.display_name ?? `${lat.toFixed(6)},${lon.toFixed(6)}`;
  } catch {
    return `${lat.toFixed(6)},${lon.toFixed(6)}`;
  }
}

export default function LocationAutocomplete({
  value, onChange, coordinate, label, placeholder, fullWidth = true, size = "medium", inputProps,
}: Props) {
  const t = useT();
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  // Track the known coordinate — set when user picks from autocomplete or Playtomic
  const [knownCoord, setKnownCoord] = useState<{ lat: number; lon: number } | undefined>(coordinate);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync external coordinate prop (e.g. from Playtomic)
  React.useEffect(() => {
    if (coordinate) setKnownCoord(coordinate);
  }, [coordinate]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    onChange(val);
    setKnownCoord(undefined); // user is typing freely — discard known coord
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!val.trim()) { setSuggestions([]); return; }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      const results = await fetchSuggestionsFromPhoton(val);
      setLoading(false);
      setSuggestions(results);
      if (results.length > 0) setOpen(true);
    }, 300);
  };

  const handleSelect = (s: Suggestion) => {
    onChange(s.label);
    setKnownCoord({ lat: s.lat, lon: s.lon }); // store exact coord from Photon
    setSuggestions([]);
    setOpen(false);
  };

  const handlePinDrop = useCallback(async (lat: number, lon: number) => {
    const address = await reverseGeocode(lat, lon);
    onChange(address);
  }, [onChange]);

  const handleUseMyLocation = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const address = await reverseGeocode(pos.coords.latitude, pos.coords.longitude);
      onChange(address);
      setMapOpen(false);
    });
  };

  return (
    <Box sx={{ position: "relative" }}>
      <TextField
        label={label ?? t("locationOptional")}
        placeholder={placeholder ?? t("locationPlaceholder")}
        fullWidth={fullWidth}
        size={size}
        value={value}
        onChange={handleInputChange}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onFocus={() => { if (suggestions.length > 0) setOpen(true); }}
        inputProps={{ maxLength: 200, ...inputProps }}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <LocationOnIcon fontSize="small" color="action" />
            </InputAdornment>
          ),
          endAdornment: (
            <InputAdornment position="end">
              {loading && <CircularProgress size={16} />}
              <Tooltip title={t("locationOpenMap")}>
                <IconButton size="small" onClick={() => setMapOpen(true)} edge="end">
                  <MapIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </InputAdornment>
          ),
        }}
      />

      {/* Autocomplete dropdown */}
      {open && suggestions.length > 0 && (
        <Paper
          elevation={4}
          sx={{
            position: "absolute", top: "100%", left: 0, right: 0,
            zIndex: 1400, mt: 0.5, borderRadius: 2, overflow: "hidden",
          }}
        >
          <List dense disablePadding>
            {suggestions.map((s, i) => (
              <ListItemButton
                key={i}
                onMouseDown={() => handleSelect(s)}
                sx={{ py: 1 }}
              >
                <LocationOnIcon fontSize="small" color="action" sx={{ mr: 1, flexShrink: 0 }} />
                <ListItemText
                  primary={s.label}
                  primaryTypographyProps={{ variant: "body2", noWrap: true }}
                />
              </ListItemButton>
            ))}
          </List>
        </Paper>
      )}

      {/* Map dialog — lazy loaded to avoid SSR issues with Leaflet */}
      <Dialog open={mapOpen} onClose={() => setMapOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", pb: 1 }}>
          <Typography variant="subtitle1" fontWeight={600}>{t("locationPickOnMap")}</Typography>
          <IconButton size="small" onClick={() => setMapOpen(false)}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent sx={{ p: 0 }}>
          {value && (
            <Box sx={{ px: 2, py: 1, bgcolor: "action.hover" }}>
              <Typography variant="caption" color="text.secondary">
                {t("locationSelected")}: <strong>{value}</strong>
              </Typography>
            </Box>
          )}
          {mapOpen && (
            <Suspense fallback={
              <Box sx={{ height: 400, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <CircularProgress />
              </Box>
            }>
              <LeafletMap initialAddress={value} initialCoordinate={knownCoord} onPinDrop={handlePinDrop} />
            </Suspense>
          )}
        </DialogContent>
        <DialogActions sx={{ justifyContent: "space-between", px: 2 }}>
          <Button size="small" startIcon={<MyLocationIcon />} variant="outlined" onClick={handleUseMyLocation}>
            {t("locationUseMyLocation")}
          </Button>
          <Button variant="contained" onClick={() => setMapOpen(false)}>
            {t("locationConfirmPin")}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
