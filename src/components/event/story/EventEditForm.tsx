import { useState } from "react";
import { Box, Button, FormControl, InputLabel, MenuItem, Select, Stack, TextField } from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { useT } from "~/lib/useT";
import { SPORT_PRESETS } from "~/lib/sports";
import { COMMON_TIMEZONES, toDateTimeLocalValue } from "~/lib/timezones";
import LocationAutocomplete from "../../LocationAutocomplete";
import type { EventData } from "../types";
import { ACTION_HEIGHT, focusRing } from "./styles";

export interface EventEdits {
  title?: string;
  location?: string;
  /** `datetime-local` value in `timezone`. */
  dateTime?: { value: string; timezone: string };
  sport?: string;
}

interface Props {
  event: EventData;
  sport: string;
  onSave: (edits: EventEdits) => void;
  onCancel: () => void;
}

const pill = { minHeight: ACTION_HEIGHT, borderRadius: 999, textTransform: "none", fontWeight: 700, flex: 1 } as const;

/**
 * Name, when and where are always there; sport and time zone sit behind "More details".
 * Esc backs out. Save hands only what changed to the page, which shows it straight away.
 */
export function EventEditForm({ event, sport, onSave, onCancel }: Props) {
  const t = useT();
  const tz0 = event.timezone || "UTC";
  const when0 = toDateTimeLocalValue(new Date(event.dateTime), tz0);
  const [title, setTitle] = useState(event.title);
  const [location, setLocation] = useState(event.location || "");
  const [when, setWhen] = useState(when0);
  const [tz, setTz] = useState(tz0);
  const [sportDraft, setSportDraft] = useState(sport);
  const [more, setMore] = useState(false);

  const save = () => {
    const edits: EventEdits = {};
    if (title.trim() && title.trim() !== event.title) edits.title = title.trim();
    if (location !== (event.location || "")) edits.location = location;
    if (when !== when0 || tz !== tz0) edits.dateTime = { value: when, timezone: tz };
    if (sportDraft && sportDraft !== sport) edits.sport = sportDraft;
    if (Object.keys(edits).length === 0) onCancel(); else onSave(edits);
  };

  return (
    <Stack
      component="form" spacing={1.5} sx={{ mt: 1.5 }}
      onSubmit={(e) => { e.preventDefault(); save(); }}
      onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }}
    >
      <TextField size="small" label={t("name")} value={title} onChange={(e) => setTitle(e.target.value)} fullWidth autoFocus slotProps={{ htmlInput: { maxLength: 100 } }} />
      <TextField size="small" type="datetime-local" label={t("dateTime")} value={when} onChange={(e) => setWhen(e.target.value)} fullWidth slotProps={{ inputLabel: { shrink: true } }} />
      <LocationAutocomplete value={location} onChange={setLocation} label={t("location")} placeholder={t("locationPlaceholder")} size="small" />

      <Button
        onClick={() => setMore((m) => !m)} aria-expanded={more} aria-controls="edit-more"
        endIcon={<ExpandMoreIcon sx={{ transform: more ? "rotate(180deg)" : "none", transition: "transform 200ms", "@media (prefers-reduced-motion: reduce)": { transition: "none" } }} />}
        sx={{ alignSelf: "flex-start", minHeight: 44, textTransform: "none", fontWeight: 600, color: "text.secondary", ...focusRing }}
      >
        {t("moreDetails")}
      </Button>
      {more && (
        <Stack id="edit-more" spacing={1.5}>
          <FormControl size="small" fullWidth>
            <InputLabel id="edit-sport">{t("sport")}</InputLabel>
            <Select labelId="edit-sport" label={t("sport")} value={sportDraft} onChange={(e) => setSportDraft(e.target.value)}>
              {SPORT_PRESETS.map((s) => <MenuItem key={s.id} value={s.id}>{t(s.labelKey)}</MenuItem>)}
            </Select>
          </FormControl>
          <FormControl size="small" fullWidth>
            <InputLabel id="edit-tz">{t("timezone")}</InputLabel>
            <Select labelId="edit-tz" label={t("timezone")} value={tz} onChange={(e) => setTz(e.target.value)}>
              {COMMON_TIMEZONES.map((z) => <MenuItem key={z.value} value={z.value}>{z.label}</MenuItem>)}
            </Select>
          </FormControl>
        </Stack>
      )}

      <Box sx={{ display: "flex", gap: 1 }}>
        <Button type="submit" variant="contained" disableElevation sx={pill}>{t("saveDateTime")}</Button>
        <Button onClick={onCancel} sx={{ ...pill, color: "text.secondary" }}>{t("cancelEdit")}</Button>
      </Box>
    </Stack>
  );
}
