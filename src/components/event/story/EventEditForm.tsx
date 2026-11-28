import { useEffect, useRef, useState } from "react";
import { Box, Button, FormControl, InputLabel, MenuItem, Select, Stack, TextField, Typography } from "@mui/material";
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

export type EditField = keyof EventEdits;

interface Props {
  event: EventData;
  sport: string;
  /** Resolves with the fields the server refused: empty means everything was saved. */
  onSave: (edits: EventEdits) => Promise<EditField[]>;
  onCancel: () => void;
}

const pill = { minHeight: ACTION_HEIGHT, borderRadius: 999, textTransform: "none", fontWeight: 700, flex: 1 } as const;

/**
 * Name, when and where are always there; sport and time zone sit behind "More details".
 * The form stays open until the server has said yes: a refused save keeps the draft,
 * says so, and puts the cursor on the field that did not go through. Esc backs out.
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
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState<EditField | null>(null);
  const formRef = useRef<HTMLDivElement>(null);
  // What the server already holds, so a retry after a partial failure sends only what is still missing.
  const savedRef = useRef({ title: event.title, location: event.location || "", when: when0, tz: tz0, sport });

  // Focus the field that failed once it is on screen (sport and time zone are behind "More details").
  useEffect(() => {
    if (!failed) return;
    formRef.current?.querySelector<HTMLElement>(`[data-field="${failed}"] input, [data-field="${failed}"] [role="combobox"]`)?.focus();
  }, [failed, more]);

  const nameMissing = !title.trim();
  const dateMissing = !when;

  const save = async () => {
    if (saving || nameMissing || dateMissing) return;
    const edits: EventEdits = {};
    const base = savedRef.current;
    if (title.trim() !== base.title) edits.title = title.trim();
    if (location !== base.location) edits.location = location;
    if (when !== base.when || tz !== base.tz) edits.dateTime = { value: when, timezone: tz };
    if (sportDraft && sportDraft !== base.sport) edits.sport = sportDraft;
    if (Object.keys(edits).length === 0) { onCancel(); return; }
    setSaving(true);
    setFailed(null);
    const refused = await onSave(edits);
    setSaving(false);
    // Remember what went through, so the retry does not send it again.
    if (edits.title !== undefined && !refused.includes("title")) base.title = edits.title;
    if (edits.location !== undefined && !refused.includes("location")) base.location = edits.location;
    if (edits.dateTime && !refused.includes("dateTime")) { base.when = when; base.tz = tz; }
    if (edits.sport && !refused.includes("sport")) base.sport = edits.sport;
    if (refused.length > 0) {
      if (refused.includes("sport")) setMore(true);
      setFailed(refused[0]);
    }
  };

  const busy = saving;
  return (
    <Stack
      component="form" id="event-edit-form" ref={formRef} spacing={1.5} sx={{ mt: 1.5 }} noValidate aria-busy={busy}
      onSubmit={(e) => { e.preventDefault(); void save(); }}
      onKeyDown={(e) => { if (e.key === "Escape" && !e.defaultPrevented && !busy) onCancel(); }}
    >
      <TextField
        size="small" label={t("name")} value={title} onChange={(e) => setTitle(e.target.value)} fullWidth autoFocus
        error={nameMissing} helperText={nameMissing ? t("editNameRequired") : undefined}
        data-field="title" slotProps={{ htmlInput: { maxLength: 100, name: "event-title", autoComplete: "off", autoCapitalize: "sentences", enterKeyHint: "done" } }}
      />
      <TextField
        size="small" type="datetime-local" label={t("dateTime")} value={when} onChange={(e) => setWhen(e.target.value)} fullWidth
        error={dateMissing} helperText={dateMissing ? t("editDateRequired") : undefined}
        data-field="dateTime" slotProps={{ inputLabel: { shrink: true } }}
      />
      <Box data-field="location">
        <LocationAutocomplete value={location} onChange={setLocation} label={t("location")} placeholder={t("locationPlaceholder")} size="small" />
      </Box>

      <Button
        onClick={() => setMore((m) => !m)} aria-expanded={more} aria-controls="edit-more"
        endIcon={<ExpandMoreIcon sx={{ transform: more ? "rotate(180deg)" : "none", transition: "transform 200ms", "@media (prefers-reduced-motion: reduce)": { transition: "none" } }} />}
        sx={{ alignSelf: "flex-start", minHeight: 44, textTransform: "none", fontWeight: 600, color: "text.secondary", ...focusRing }}
      >
        {t("moreDetails")}
      </Button>
      {more && (
        <Stack id="edit-more" spacing={1.5}>
          <FormControl size="small" fullWidth data-field="sport">
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

      {failed && <Typography role="alert" sx={{ color: "error.main", fontSize: "1rem", lineHeight: 1.4 }}>{t("editNotSaved")}</Typography>}
      <Box sx={{ display: "flex", gap: 1 }}>
        <Button type="submit" variant="contained" disableElevation disabled={busy || nameMissing || dateMissing} sx={pill}>{t("saveDateTime")}</Button>
        <Button onClick={onCancel} disabled={busy} sx={{ ...pill, color: "text.secondary" }}>{t("cancelEdit")}</Button>
      </Box>
    </Stack>
  );
}
