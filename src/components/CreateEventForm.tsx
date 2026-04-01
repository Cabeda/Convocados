import React, { useState } from "react";
import {
  Container, Paper, Typography, TextField, Button, Box, Stack,
  FormControlLabel, Select, MenuItem, FormControl, InputLabel,
  Grid2, Alert, Divider, Chip, Accordion, AccordionSummary, AccordionDetails,
  InputAdornment, IconButton, Tooltip, ToggleButton, ToggleButtonGroup,
  Dialog, DialogTitle, DialogContent, DialogActions,
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

const DAY_CODES = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;
const DAY_KEYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;

const DAYS = DAY_CODES.map((value, i) => ({ value, key: DAY_KEYS[i] }));

/** Map JS getDay() (0=Sun) to our DAY_CODES index (0=Mon) */
function jsDayToDayCode(jsDay: number): string {
  return DAY_CODES[(jsDay + 6) % 7]; // Sun=0 → index 6, Mon=1 → index 0, etc.
}

/** Map JS getDay() (0=Sun) to our DAYS array index (0=Mon) */
function jsDayToDayIndex(jsDay: number): number {
  return (jsDay + 6) % 7;
}

type RecurrencePreset = "none" | "daily" | "weekly" | "monthly" | "yearly" | "custom";
type RecurrenceFreq = "daily" | "weekly" | "monthly" | "yearly";

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
  const [recurrencePreset, setRecurrencePreset] = useState<RecurrencePreset>("none");
  const [customFreq, setCustomFreq] = useState<RecurrenceFreq>("weekly");
  const [customInterval, setCustomInterval] = useState(1);
  const [customByDays, setCustomByDays] = useState<string[]>([]);
  const [customDialogOpen, setCustomDialogOpen] = useState(false);
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

    // Derive recurrence fields from preset/custom state
    const isRecurring = recurrencePreset !== "none";
    let recurrenceFreq: RecurrenceFreq | null = null;
    let recurrenceInterval = 1;
    let recurrenceByDay: string | null = null;

    if (recurrencePreset === "daily") {
      recurrenceFreq = "daily";
    } else if (recurrencePreset === "weekly") {
      recurrenceFreq = "weekly";
      const eventDay = jsDayToDayCode(new Date(dateTime).getDay());
      recurrenceByDay = eventDay;
    } else if (recurrencePreset === "monthly") {
      recurrenceFreq = "monthly";
    } else if (recurrencePreset === "yearly") {
      recurrenceFreq = "yearly";
    } else if (recurrencePreset === "custom") {
      recurrenceFreq = customFreq;
      recurrenceInterval = customInterval;
      if (customFreq === "weekly" && customByDays.length > 0) {
        recurrenceByDay = customByDays.join(",");
      }
    }

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
      recurrenceFreq,
      recurrenceInterval: isRecurring ? recurrenceInterval : null,
      recurrenceByDay: isRecurring ? recurrenceByDay : null,
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

                  <FormControl fullWidth>
                    <InputLabel>{t("recurrence")}</InputLabel>
                    <Select
                      value={recurrencePreset}
                      label={t("recurrence")}
                      renderValue={(val) => {
                        if (val === "none") return t("doesNotRepeat");
                        if (val === "daily") return t("daily");
                        if (val === "weekly") return t("weeklyOnDay", { day: t(DAYS[jsDayToDayIndex(new Date(dateTime).getDay())].key) });
                        if (val === "monthly") return t("monthlyOnDay", { day: String(new Date(dateTime).getDate()) });
                        if (val === "yearly") return t("annually", { date: new Date(dateTime).toLocaleDateString(locale, { month: "short", day: "numeric" }) });
                        if (val === "custom") return t("customRecurrence");
                        return "";
                      }}
                      onChange={(e) => {
                        const val = e.target.value as RecurrencePreset;
                        if (val === "custom") {
                          const eventDay = jsDayToDayCode(new Date(dateTime).getDay());
                          if (customByDays.length === 0) setCustomByDays([eventDay]);
                          setCustomDialogOpen(true);
                        } else {
                          setRecurrencePreset(val);
                        }
                      }}
                    >
                      <MenuItem value="none">{t("doesNotRepeat")}</MenuItem>
                      <MenuItem value="daily">{t("daily")}</MenuItem>
                      <MenuItem value="weekly">
                        {t("weeklyOnDay", { day: t(DAYS[jsDayToDayIndex(new Date(dateTime).getDay())].key) })}
                      </MenuItem>
                      <MenuItem value="monthly">
                        {t("monthlyOnDay", { day: String(new Date(dateTime).getDate()) })}
                      </MenuItem>
                      <MenuItem value="yearly">
                        {t("annually", { date: new Date(dateTime).toLocaleDateString(locale, { month: "short", day: "numeric" }) })}
                      </MenuItem>
                      <Divider />
                      <MenuItem value="custom">{t("customRecurrence")}</MenuItem>
                    </Select>
                  </FormControl>

                  {recurrencePreset !== "none" && (
                    <Alert severity="info" sx={{ fontSize: "0.85rem" }}>
                      {t("recurrenceInfo")}
                    </Alert>
                  )}

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
        <Dialog
          open={customDialogOpen}
          onClose={() => setCustomDialogOpen(false)}
          maxWidth="xs"
          fullWidth
        >
          <DialogTitle>{t("customRecurrenceTitle")}</DialogTitle>
          <DialogContent>
            <Stack spacing={2.5} sx={{ mt: 1 }}>
              <Grid2 container spacing={2} alignItems="center">
                <Grid2 size={{ xs: 5 }}>
                  <TextField
                    label={t("repeatEvery")}
                    type="number"
                    value={customInterval}
                    onChange={(e) => setCustomInterval(Math.max(1, parseInt(e.target.value) || 1))}
                    inputProps={{ min: 1, max: 52 }}
                    fullWidth
                    size="small"
                  />
                </Grid2>
                <Grid2 size={{ xs: 7 }}>
                  <FormControl fullWidth size="small">
                    <InputLabel>{t("frequency")}</InputLabel>
                    <Select
                      value={customFreq}
                      label={t("frequency")}
                      onChange={(e) => setCustomFreq(e.target.value as RecurrenceFreq)}
                    >
                      <MenuItem value="daily">{t("days")}</MenuItem>
                      <MenuItem value="weekly">{t("weeks")}</MenuItem>
                      <MenuItem value="monthly">{t("months")}</MenuItem>
                      <MenuItem value="yearly">{t("years")}</MenuItem>
                    </Select>
                  </FormControl>
                </Grid2>
              </Grid2>

              {customFreq === "weekly" && (
                <Box>
                  <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: "block" }}>
                    {t("onDays")}
                  </Typography>
                  <ToggleButtonGroup
                    value={customByDays}
                    onChange={(_e, newDays: string[]) => setCustomByDays(newDays)}
                    aria-label={t("onDays")}
                    size="small"
                    sx={{ flexWrap: "wrap", gap: 0.5 }}
                  >
                    {DAYS.map((d) => (
                      <ToggleButton key={d.value} value={d.value} aria-label={t(d.key)}>
                        {t(d.key).slice(0, 2)}
                      </ToggleButton>
                    ))}
                  </ToggleButtonGroup>
                </Box>
              )}
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setCustomDialogOpen(false)}>{t("cancel")}</Button>
            <Button
              variant="contained"
              onClick={() => {
                setRecurrencePreset("custom");
                setCustomDialogOpen(false);
              }}
            >
              {t("done")}
            </Button>
          </DialogActions>
        </Dialog>
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
