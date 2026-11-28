import { useEffect, useMemo, useState } from "react";
import { Box, Button, FormControlLabel, Radio, RadioGroup, TextField, Typography } from "@mui/material";
import { useT } from "~/lib/useT";
import { apiRequest } from "~/lib/api/client";

interface Candidate { id: string; name: string }

export interface MvpPickerProps {
  eventId: string;
  historyId: string;
  /** The viewer: nobody votes for themselves. */
  selfName: string | null;
  onVoted: (name: string) => void;
}

const SEARCH_ABOVE = 8;

/** Vote for MVP inline: one big row per player, a search box for long lists, one Confirm. */
export function MvpPicker({ eventId, historyId, selfName, onVoted }: MvpPickerProps) {
  const t = useT();
  const [people, setPeople] = useState<Candidate[] | null>(null);
  const [pick, setPick] = useState("");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let live = true;
    apiRequest("GET /api/events/{id}/history/{historyId}/mvp", { params: { id: eventId, historyId } })
      .then((data) => {
        const list = ((data as { participants?: Candidate[] }).participants ?? []);
        if (live) setPeople(list.filter((p) => p.name.trim().toLowerCase() !== (selfName ?? "").trim().toLowerCase()));
      })
      .catch(() => { if (live) setPeople([]); });
    return () => { live = false; };
  }, [eventId, historyId, selfName]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (people ?? []).filter((p) => !q || p.name.toLowerCase().includes(q));
  }, [people, query]);

  if (!people) return null;

  const confirm = async () => {
    const chosen = people.find((p) => p.id === pick);
    if (!chosen) return;
    setBusy(true);
    setError(false);
    try {
      await apiRequest("POST /api/events/{id}/history/{historyId}/mvp-vote", {
        params: { id: eventId, historyId },
        body: { votedForPlayerId: chosen.id },
      });
      onVoted(chosen.name);
    } catch {
      setError(true);
      setBusy(false);
    }
  };

  return (
    <Box sx={{ px: 2, pb: 2 }}>
      {people.length > SEARCH_ABOVE && (
        <TextField
          fullWidth size="small" value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder={t("recapMvpSearch")} slotProps={{ htmlInput: { "aria-label": t("recapMvpSearch") } }} sx={{ mb: 1 }}
        />
      )}
      <RadioGroup aria-label={t("recapMvpCandidates")} value={pick} onChange={(e) => setPick(e.target.value)}>
        {shown.map((p) => (
          <FormControlLabel
            key={p.id} value={p.id} label={p.name}
            control={<Radio />}
            sx={{
              m: 0, minHeight: 52, borderTop: 1, borderColor: "divider", "&:first-of-type": { borderTop: 0 },
              "& .MuiFormControlLabel-label": { fontSize: "1.0625rem", fontWeight: pick === p.id ? 700 : 400 },
            }}
          />
        ))}
      </RadioGroup>
      {error && <Typography role="alert" sx={{ color: "error.main", fontSize: "0.875rem", py: 0.5 }}>{t("recapMvpError")}</Typography>}
      <Button
        fullWidth variant="contained" disableElevation disabled={!pick || busy} onClick={confirm}
        sx={{ mt: 1, minHeight: 52, borderRadius: 999, fontSize: "1.0625rem", fontWeight: 700, textTransform: "none" }}
      >
        {t("recapMvpConfirm")}
      </Button>
    </Box>
  );
}
