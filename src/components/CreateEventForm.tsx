import React, { useState } from "react";
import {
  Container, Paper, Typography, TextField, Button, Box, Stack,
  FormControlLabel, Switch, Select, MenuItem, FormControl, InputLabel,
  Grid2, Alert, Divider, Chip, Accordion, AccordionSummary, AccordionDetails,
  InputAdornment, IconButton, Tooltip,
} from "@mui/material";
import AddCircleOutlineIcon from "@mui/icons-material/AddCircleOutline";
import SportsIcon from "@mui/icons-material/Sports";
import CasinoIcon from "@mui/icons-material/Casino";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import PeopleIcon from "@mui/icons-material/People";
import PlaceIcon from "@mui/icons-material/Place";
import { ThemeModeProvider } from "./ThemeModeProvider";
import { ResponsiveLayout } from "./ResponsiveLayout";
import PlaytomicCourtFinder from "./PlaytomicCourtFinder";
import LocationAutocomplete from "./LocationAutocomplete";
import { useT } from "~/lib/useT";
import { detectLocale } from "~/lib/i18n";
import { SPORT_PRESETS, getDefaultMaxPlayers } from "~/lib/sports";
import { isPlaytomicSport } from "~/lib/playtomic";
import { getRandomTitle, type TitleLocale } from "~/lib/randomTitles";
import { COMMON_TIMEZONES, detectTimezone } from "~/lib/timezones";

const DAYS = [
  { value: "MO", key: "monday" },
  { value: "TU", key: "tuesday" },
  { value: "WE", key: "wednesday" },
  { value: "TH", key: "thursday" },
  { value: "FR", key: "friday" },
  { value: "SA", key: "saturday" },
  { value: "SU", key: "sunday" },
] as const;

function nextHour() {
  const d = new Date();
  d.setHours(d.getHours() + 1, 0, 0, 0);
  // toISOString gives UTC; we need local datetime-local format
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`;
}

function minDateTime() {
  const d = new Date();
  d.setSeconds(0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function CreateEventForm() {
  const t = useT();
  const locale = detectLocale();
  const [title, setTitle] = useState(() => getRandomTitle(locale as TitleLocale));
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurrenceFreq, setRecurrenceFreq] = useState<"weekly" | "monthly">("weekly");
  const [recurrenceInterval, setRecurrenceInterval] = useState(1);
  const [recurrenceByDay, setRecurrenceByDay] = useState("");
  const [sport, setSport] = useState("football-5v5");
  const [maxPlayers, setMaxPlayers] = useState("10");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [location, setLocation] = useState("");
  const [locationCoord, setLocationCoord] = useState<{ lat: number; lon: number } | undefined>();
  const [courtFinderOpen, setCourtFinderOpen] = useState(false);
  const [dateTime, setDateTime] = useState(nextHour);
  const [timezone, setTimezone] = useState(() => detectTimezone());

  const handleSportChange = (newSport: string) => {
    setSport(newSport);
    setMaxPlayers(String(getDefaultMaxPlayers(newSport)));
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const parsedMaxPlayers = parseInt(maxPlayers, 10);
    if (isNaN(parsedMaxPlayers) || parsedMaxPlayers < 2 || parsedMaxPlayers > 100) {
      setError(t("maxPlayersError"));
      setSubmitting(false);
      return;
    }

    const form = e.currentTarget;
    const fd = new FormData(form);

    const body = {
      title: fd.get("title"),
      location: location || "",
      dateTime: dateTime,
      timezone,
      teamOneName: fd.get("teamOneName"),
      teamTwoName: fd.get("teamTwoName"),
      maxPlayers: parsedMaxPlayers,
      sport,
      isRecurring,
      recurrenceFreq: isRecurring ? recurrenceFreq : null,
      recurrenceInterval: isRecurring ? recurrenceInterval : null,
      recurrenceByDay: isRecurring && recurrenceFreq === "weekly" ? recurrenceByDay || null : null,
    };

    const res = await fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();

    if (!res.ok) {
      setError(json.error ?? t("somethingWentWrong"));
      setSubmitting(false);
      return;
    }

    window.location.href = `/events/${json.id}`;
  };

  return (
    <ThemeModeProvider>
      <ResponsiveLayout>
        <Container maxWidth="sm" sx={{ py: 6 }}>
          <Stack spacing={4}>
            <Box textAlign="center">
              <SportsIcon sx={{ fontSize: 56, color: "primary.main", mb: 1 }} />
              <Typography variant="h4" fontWeight={700}>{t("createGame")}</Typography>
              <Typography variant="body1" color="text.secondary" mt={1}>
                {t("createGameSubtitle")}
              </Typography>
            </Box>

            <Paper elevation={2} sx={{ borderRadius: 3, p: { xs: 3, sm: 4 } }}>
              <form onSubmit={handleSubmit}>
                <Stack spacing={3}>
                  {error && <Alert severity="error">{error}</Alert>}

                  <TextField name="title" label={t("gameTitle")}
                    placeholder={t("gameTitlePlaceholder")} required fullWidth
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    inputProps={{ maxLength: 100 }}
                    InputProps={{
                      endAdornment: (
                        <InputAdornment position="end">
                          <Tooltip title={t("randomizeTitle")}>
                            <IconButton
                              size="small"
                              onClick={() => setTitle(getRandomTitle(locale as TitleLocale))}
                              sx={{
                                transition: "transform 0.2s",
                                "&:hover": { transform: "rotate(180deg)" },
                              }}
                            >
                              <CasinoIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </InputAdornment>
                      ),
                    }}
                  />

                  <FormControl fullWidth>
                    <InputLabel>{t("sport")}</InputLabel>
                    <Select value={sport} label={t("sport")}
                      onChange={(e) => handleSportChange(e.target.value)}>
                      {SPORT_PRESETS.map((s) => (
                        <MenuItem key={s.id} value={s.id}>
                          {t(s.labelKey as any)} ({s.defaultMaxPlayers})
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>

                  <TextField name="dateTime" label={t("dateTime")} type="datetime-local"
                    required fullWidth value={dateTime}
                    onChange={(e) => setDateTime(e.target.value)}
                    inputProps={{ min: minDateTime() }}
                    InputLabelProps={{ shrink: true }} />

                  <FormControl fullWidth>
                    <InputLabel>{t("timezone")}</InputLabel>
                    <Select value={timezone} label={t("timezone")}
                      onChange={(e) => setTimezone(e.target.value)}>
                      {COMMON_TIMEZONES.map((tz) => (
                        <MenuItem key={tz.value} value={tz.value}>{tz.label}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>

                  {/* Advanced options */}
                  <Accordion disableGutters elevation={0} sx={{
                    border: "1px solid",
                    borderColor: "divider",
                    borderRadius: "8px !important",
                    "&:before": { display: "none" },
                  }}>
                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                      <Typography variant="body2" color="text.secondary">{t("advancedOptions")}</Typography>
                    </AccordionSummary>
                    <AccordionDetails>
                      <Stack spacing={3}>
                        <LocationAutocomplete
                          value={location}
                          onChange={(v) => { setLocation(v); setLocationCoord(undefined); }}
                          coordinate={locationCoord}
                          label={t("locationOptional")}
                          placeholder={t("locationPlaceholder")}
                        />

                        {isPlaytomicSport(sport) && (
                          <Button
                            variant="outlined"
                            size="small"
                            startIcon={<PlaceIcon />}
                            onClick={() => setCourtFinderOpen(true)}
                          >
                            {t("playtomicFindCourt")}
                          </Button>
                        )}

                        <TextField
                          label={t("maxPlayers")}
                          type="number"
                          value={maxPlayers}
                          onChange={(e) => setMaxPlayers(e.target.value)}
                          inputProps={{ min: 2, max: 100 }}
                          helperText={t("maxPlayersHelper")}
                          fullWidth
                          error={maxPlayers !== "" && (isNaN(parseInt(maxPlayers)) || parseInt(maxPlayers) < 2 || parseInt(maxPlayers) > 100)}
                          InputProps={{
                            startAdornment: (
                              <InputAdornment position="start"><PeopleIcon fontSize="small" /></InputAdornment>
                            ),
                          }}
                        />

                        <Divider><Chip label={t("teamNames")} size="small" /></Divider>

                        <Grid2 container spacing={2}>
                          <Grid2 size={{ xs: 12, sm: 6 }}>
                            <TextField name="teamOneName" label={t("team1Name")}
                              defaultValue="Ninjas" fullWidth inputProps={{ maxLength: 50 }} />
                          </Grid2>
                          <Grid2 size={{ xs: 12, sm: 6 }}>
                            <TextField name="teamTwoName" label={t("team2Name")}
                              defaultValue="Gunas" fullWidth inputProps={{ maxLength: 50 }} />
                          </Grid2>
                        </Grid2>

                        <Divider><Chip label={t("recurrence")} size="small" /></Divider>

                        <FormControlLabel
                          control={
                            <Switch name="isRecurring" checked={isRecurring}
                              onChange={(e) => setIsRecurring(e.target.checked)} />
                          }
                          label={t("recurringGame")}
                        />

                        {isRecurring && (
                          <Stack spacing={2}>
                            <Grid2 container spacing={2} alignItems="center">
                              <Grid2 size={{ xs: 4 }}>
                                <TextField label={t("every")} type="number" name="recurrenceInterval"
                                  value={recurrenceInterval}
                                  onChange={(e) => setRecurrenceInterval(Math.max(1, parseInt(e.target.value) || 1))}
                                  inputProps={{ min: 1, max: 52 }} fullWidth />
                              </Grid2>
                              <Grid2 size={{ xs: 8 }}>
                                <FormControl fullWidth>
                                  <InputLabel>{t("frequency")}</InputLabel>
                                  <Select name="recurrenceFreq" value={recurrenceFreq} label={t("frequency")}
                                    onChange={(e) => setRecurrenceFreq(e.target.value as "weekly" | "monthly")}>
                                    <MenuItem value="weekly">{t("weeks")}</MenuItem>
                                    <MenuItem value="monthly">{t("months")}</MenuItem>
                                  </Select>
                                </FormControl>
                              </Grid2>
                            </Grid2>

                            {recurrenceFreq === "weekly" && (
                              <FormControl fullWidth>
                                <InputLabel>{t("onDay")}</InputLabel>
                                <Select name="recurrenceByDay" value={recurrenceByDay}
                                  label={t("onDay")}
                                  onChange={(e) => setRecurrenceByDay(e.target.value)}>
                                  <MenuItem value="">{t("sameDayAsEvent")}</MenuItem>
                                  {DAYS.map((d) => (
                                    <MenuItem key={d.value} value={d.value}>{t(d.key)}</MenuItem>
                                  ))}
                                </Select>
                              </FormControl>
                            )}

                            <Alert severity="info" sx={{ fontSize: "0.85rem" }}>
                              {t("recurrenceInfo")}
                            </Alert>
                          </Stack>
                        )}
                      </Stack>
                    </AccordionDetails>
                  </Accordion>

                  <Button type="submit" variant="contained" size="large" fullWidth
                    disabled={submitting} startIcon={<AddCircleOutlineIcon />}
                    sx={{ py: 1.5, mt: 1 }}>
                    {submitting ? t("creating") : t("createGameBtn")}
                  </Button>
                </Stack>
              </form>
            </Paper>
          </Stack>
        </Container>
        <PlaytomicCourtFinder
          open={courtFinderOpen}
          onClose={() => setCourtFinderOpen(false)}
          sport={sport}
          date={dateTime.split("T")[0] || new Date().toISOString().split("T")[0]}
          onSelect={(loc, coord) => {
            setLocation(loc);
            setLocationCoord(coord ? { lat: coord.lat, lon: coord.lng } : undefined);
          }}
        />
      </ResponsiveLayout>
    </ThemeModeProvider>
  );
}
