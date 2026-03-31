/// <reference types="@types/google.maps" />
import React, { useState, useRef, useEffect, useCallback } from "react";
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

interface Suggestion {
  placeId: string;
  description: string;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  placeholder?: string;
  fullWidth?: boolean;
  size?: "small" | "medium";
  inputProps?: Record<string, unknown>;
}

const GOOGLE_MAPS_API_KEY = (import.meta as any).env?.PUBLIC_GOOGLE_MAPS_API_KEY ?? "";

// Load the Google Maps JS SDK once
let sdkPromise: Promise<void> | null = null;
function loadGoogleMaps(): Promise<void> {
  if (!GOOGLE_MAPS_API_KEY) return Promise.resolve();
  if (typeof window === "undefined") return Promise.resolve();
  if ((window as any).google?.maps?.places) return Promise.resolve();
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&libraries=places`;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = reject;
    document.head.appendChild(script);
  });
  return sdkPromise;
}

export default function LocationAutocomplete({
  value, onChange, label, placeholder, fullWidth = true, size = "medium", inputProps,
}: Props) {
  const t = useT();
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [sdkReady, setSdkReady] = useState(false);
  const autocompleteService = useRef<google.maps.places.AutocompleteService | null>(null);
  const geocoderRef = useRef<google.maps.Geocoder | null>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!GOOGLE_MAPS_API_KEY) return;
    loadGoogleMaps().then(() => {
      autocompleteService.current = new google.maps.places.AutocompleteService();
      geocoderRef.current = new google.maps.Geocoder();
      setSdkReady(true);
    }).catch(() => {/* SDK failed to load — degrade gracefully */});
  }, []);

  const fetchSuggestions = useCallback((input: string) => {
    if (!sdkReady || !autocompleteService.current || input.length < 2) {
      setSuggestions([]);
      return;
    }
    setLoading(true);
    autocompleteService.current.getPlacePredictions(
      { input },
      (
        predictions: google.maps.places.AutocompletePrediction[] | null,
        status: google.maps.places.PlacesServiceStatus,
      ) => {
        setLoading(false);
        if (status === google.maps.places.PlacesServiceStatus.OK && predictions) {
          setSuggestions(predictions.map((p) => ({ placeId: p.place_id, description: p.description })));
          setOpen(true);
        } else {
          setSuggestions([]);
        }
      },
    );
  }, [sdkReady]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    onChange(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(val), 300);
  };

  const handleSelect = (description: string) => {
    onChange(description);
    setSuggestions([]);
    setOpen(false);
  };

  // ── Map dialog ────────────────────────────────────────────────────────────

  const initMap = useCallback(() => {
    if (!mapRef.current || !sdkReady) return;
    const defaultCenter = { lat: 41.1579, lng: -8.6291 }; // Porto fallback
    const map = new google.maps.Map(mapRef.current, {
      center: defaultCenter,
      zoom: 14,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
    });
    mapInstanceRef.current = map;

    const marker = new google.maps.Marker({
      position: defaultCenter,
      map,
      draggable: true,
      title: t("locationDragPin"),
    });
    markerRef.current = marker;

    // If we already have a value, geocode it to center the map
    if (value && geocoderRef.current) {
      geocoderRef.current.geocode({ address: value }, (
        results: google.maps.GeocoderResult[] | null,
        status: google.maps.GeocoderStatus,
      ) => {
        if (status === "OK" && results?.[0]) {
          const loc = results[0].geometry.location;
          map.setCenter(loc);
          marker.setPosition(loc);
        }
      });
    }

    // Update location when marker is dragged
    marker.addListener("dragend", () => {
      const pos = marker.getPosition();
      if (!pos || !geocoderRef.current) return;
      geocoderRef.current.geocode({ location: pos }, (
        results: google.maps.GeocoderResult[] | null,
        status: google.maps.GeocoderStatus,
      ) => {
        if (status === "OK" && results?.[0]) {
          onChange(results[0].formatted_address);
        } else {
          onChange(`${pos.lat().toFixed(6)},${pos.lng().toFixed(6)}`);
        }
      });
    });

    // Click on map to move marker
    map.addListener("click", (e: google.maps.MapMouseEvent) => {
      if (!e.latLng) return;
      marker.setPosition(e.latLng);
      if (!geocoderRef.current) return;
      geocoderRef.current.geocode({ location: e.latLng }, (
        results: google.maps.GeocoderResult[] | null,
        status: google.maps.GeocoderStatus,
      ) => {
        if (status === "OK" && results?.[0]) {
          onChange(results[0].formatted_address);
        } else {
          onChange(`${e.latLng!.lat().toFixed(6)},${e.latLng!.lng().toFixed(6)}`);
        }
      });
    });
  }, [sdkReady, value, onChange, t]);

  useEffect(() => {
    if (mapOpen && sdkReady) {
      setTimeout(initMap, 100);
    }
  }, [mapOpen, sdkReady, initMap]);

  const handleUseMyLocation = () => {
    if (!navigator.geolocation || !mapInstanceRef.current || !markerRef.current) return;
    navigator.geolocation.getCurrentPosition((pos) => {
      const latLng = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      mapInstanceRef.current!.setCenter(latLng);
      markerRef.current!.setPosition(latLng);
      if (geocoderRef.current) {
        geocoderRef.current.geocode({ location: latLng }, (
          results: google.maps.GeocoderResult[] | null,
          status: google.maps.GeocoderStatus,
        ) => {
          if (status === "OK" && results?.[0]) {
            onChange(results[0].formatted_address);
          } else {
            onChange(`${latLng.lat.toFixed(6)},${latLng.lng.toFixed(6)}`);
          }
        });
      }
    });
  };

  const hasMapSupport = sdkReady && !!GOOGLE_MAPS_API_KEY;

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
              {hasMapSupport && (
                <Tooltip title={t("locationOpenMap")}>
                  <IconButton size="small" onClick={() => setMapOpen(true)} edge="end">
                    <MapIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
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
            {suggestions.map((s) => (
              <ListItemButton
                key={s.placeId}
                onMouseDown={() => handleSelect(s.description)}
                sx={{ py: 1 }}
              >
                <LocationOnIcon fontSize="small" color="action" sx={{ mr: 1, flexShrink: 0 }} />
                <ListItemText
                  primary={s.description}
                  primaryTypographyProps={{ variant: "body2", noWrap: true }}
                />
              </ListItemButton>
            ))}
          </List>
        </Paper>
      )}

      {/* Map dialog */}
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
          <Box ref={mapRef} sx={{ width: "100%", height: 400 }} />
        </DialogContent>
        <DialogActions sx={{ justifyContent: "space-between", px: 2 }}>
          <Button
            size="small"
            startIcon={<MyLocationIcon />}
            onClick={handleUseMyLocation}
            variant="outlined"
          >
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
