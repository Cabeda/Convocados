import React, { useState, useCallback } from "react";
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  List, ListItem, ListItemText, ListItemButton, Typography, Box, Stack,
  CircularProgress, Alert, Chip, IconButton, Collapse, Divider,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import PlaceIcon from "@mui/icons-material/Place";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import { useT } from "~/lib/useT";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Club {
  tenant_id: string;
  tenant_name: string;
  address: { street: string; city: string; postal_code: string; country: string } | null;
  coordinate: { lat: number; lon: number } | null;
  images: string[];
}

interface Slot {
  start_time: string;
  duration: number;
  price: number;
  currency: string;
}

interface Court {
  resource_id: string;
  resource_name: string;
  slots: Slot[];
}

interface Props {
  open: boolean;
  onClose: () => void;
  sport: string;
  date: string; // YYYY-MM-DD
  onSelect: (location: string, coordinate?: { lat: number; lng: number }) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function PlaytomicCourtFinder({ open, onClose, sport, date, onSelect }: Props) {
  const t = useT();

  // Search state
  const [searchLoading, setSearchLoading] = useState(false);
  const [clubs, setClubs] = useState<Club[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  // Availability state
  const [expandedClub, setExpandedClub] = useState<string | null>(null);
  const [courts, setCourts] = useState<Record<string, Court[]>>({});
  const [availLoading, setAvailLoading] = useState<string | null>(null);
  const [availError, setAvailError] = useState<string | null>(null);

  const searchNearby = useCallback(async () => {
    setSearchLoading(true);
    setSearchError(null);
    setClubs([]);
    setSearched(true);

    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000 });
      });

      const { latitude, longitude } = pos.coords;
      const res = await fetch(
        `/api/playtomic/clubs?lat=${latitude}&lng=${longitude}&sport=${encodeURIComponent(sport)}`,
      );
      const data = await res.json();

      if (!res.ok) {
        setSearchError(data.error ?? t("somethingWentWrong"));
      } else {
        setClubs(data.clubs ?? []);
      }
    } catch (err: any) {
      if (err?.code === 1) {
        setSearchError(t("playtomicLocationDenied"));
      } else {
        setSearchError(t("playtomicSearchError"));
      }
    } finally {
      setSearchLoading(false);
    }
  }, [sport, t]);

  const loadAvailability = useCallback(
    async (tenantId: string) => {
      if (expandedClub === tenantId) {
        setExpandedClub(null);
        return;
      }

      setExpandedClub(tenantId);

      if (courts[tenantId]) return; // already loaded

      setAvailLoading(tenantId);
      setAvailError(null);

      try {
        const res = await fetch(
          `/api/playtomic/availability?tenantId=${tenantId}&date=${date}&sport=${encodeURIComponent(sport)}`,
        );
        const data = await res.json();

        if (!res.ok) {
          setAvailError(data.error ?? t("somethingWentWrong"));
        } else {
          setCourts((prev) => ({ ...prev, [tenantId]: data.courts ?? [] }));
        }
      } catch {
        setAvailError(t("playtomicAvailabilityError"));
      } finally {
        setAvailLoading(null);
      }
    },
    [expandedClub, courts, date, sport, t],
  );

  const handleSelect = (club: Club) => {
    const parts = [club.tenant_name];
    if (club.address) {
      if (club.address.street) parts.push(club.address.street);
      if (club.address.city) parts.push(club.address.city);
    }
    const location = parts.join(", ");
    const coordinate = club.coordinate ? { lat: club.coordinate.lat, lng: club.coordinate.lon } : undefined;
    onSelect(location, coordinate);
    onClose();
  };

  const handleClose = () => {
    onClose();
  };

  const formatTime = (time: string) => time.slice(0, 5); // "HH:mm:ss" -> "HH:mm"
  const formatPrice = (price: number, currency: string) =>
    new Intl.NumberFormat(undefined, { style: "currency", currency }).format(price);

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Stack direction="row" alignItems="center" spacing={1}>
          <PlaceIcon color="primary" />
          <Typography variant="h6" fontWeight={600}>{t("playtomicFindCourt")}</Typography>
        </Stack>
      </DialogTitle>

      <DialogContent dividers>
        <Stack spacing={2}>
          {/* Search button */}
          <Button
            variant="contained"
            startIcon={searchLoading ? <CircularProgress size={18} color="inherit" /> : <SearchIcon />}
            onClick={searchNearby}
            disabled={searchLoading}
            fullWidth
          >
            {searchLoading ? t("playtomicSearching") : t("playtomicSearchNearby")}
          </Button>

          {searchError && <Alert severity="error">{searchError}</Alert>}

          {/* Results */}
          {searched && !searchLoading && clubs.length === 0 && !searchError && (
            <Alert severity="info">{t("playtomicNoClubs")}</Alert>
          )}

          {clubs.length > 0 && (
            <List disablePadding>
              {clubs.map((club) => (
                <React.Fragment key={club.tenant_id}>
                  <ListItem disablePadding sx={{ flexDirection: "column", alignItems: "stretch" }}>
                    <ListItemButton onClick={() => loadAvailability(club.tenant_id)}>
                      <ListItemText
                        primary={club.tenant_name}
                        secondary={
                          club.address
                            ? [club.address.street, club.address.city].filter(Boolean).join(", ")
                            : null
                        }
                      />
                      <Stack direction="row" spacing={0.5} alignItems="center">
                        <IconButton
                          size="small"
                          href={`https://playtomic.io/tenant/${club.tenant_id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          title={t("playtomicOpenInPlaytomic")}
                        >
                          <OpenInNewIcon fontSize="small" />
                        </IconButton>
                        {expandedClub === club.tenant_id ? (
                          <ExpandLessIcon fontSize="small" />
                        ) : (
                          <ExpandMoreIcon fontSize="small" />
                        )}
                      </Stack>
                    </ListItemButton>

                    {/* Availability panel */}
                    <Collapse in={expandedClub === club.tenant_id}>
                      <Box sx={{ px: 2, pb: 2 }}>
                        {availLoading === club.tenant_id && (
                          <Box textAlign="center" py={2}>
                            <CircularProgress size={24} />
                          </Box>
                        )}

                        {availError && expandedClub === club.tenant_id && (
                          <Alert severity="error" sx={{ mb: 1 }}>{availError}</Alert>
                        )}

                        {courts[club.tenant_id] && (
                          <>
                            {courts[club.tenant_id].length === 0 ? (
                              <Typography variant="body2" color="text.secondary">
                                {t("playtomicNoSlots")}
                              </Typography>
                            ) : (
                              <Stack spacing={1}>
                                {courts[club.tenant_id].map((court) => (
                                  <Box key={court.resource_id}>
                                    <Typography variant="body2" fontWeight={600} sx={{ mb: 0.5 }}>
                                      {court.resource_name}
                                    </Typography>
                                    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                                      {court.slots.length === 0 ? (
                                        <Typography variant="caption" color="text.secondary">
                                          {t("playtomicNoSlots")}
                                        </Typography>
                                      ) : (
                                        court.slots.map((slot, i) => (
                                          <Chip
                                            key={i}
                                            label={`${formatTime(slot.start_time)} - ${formatPrice(slot.price, slot.currency)}`}
                                            size="small"
                                            variant="outlined"
                                            color="primary"
                                          />
                                        ))
                                      )}
                                    </Box>
                                  </Box>
                                ))}
                              </Stack>
                            )}

                            <Button
                              variant="outlined"
                              size="small"
                              sx={{ mt: 1.5 }}
                              onClick={() => handleSelect(club)}
                            >
                              {t("playtomicSelectClub")}
                            </Button>
                          </>
                        )}
                      </Box>
                    </Collapse>
                  </ListItem>
                  <Divider />
                </React.Fragment>
              ))}
            </List>
          )}
        </Stack>
      </DialogContent>

      <DialogActions>
        <Button onClick={handleClose}>{t("cancel")}</Button>
      </DialogActions>
    </Dialog>
  );
}
