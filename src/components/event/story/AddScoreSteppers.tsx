import { useEffect, useRef, useState } from "react";
import { Box, Button, IconButton, Typography } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import RemoveIcon from "@mui/icons-material/Remove";
import { useT } from "~/lib/useT";
import { apiRequest } from "~/lib/api/client";
import { NUMERAL_FONT } from "./Scoreboard";

export interface AddScoreSteppersProps {
  eventId: string;
  historyId: string;
  teamOneName: string;
  teamTwoName: string;
  /** Called with the saved result; the digits then roll on the scoreboard. */
  onSaved: (scoreOne: number, scoreTwo: number) => void;
  /** Move focus to the first stepper (the add-score deep link). */
  autoFocus?: boolean;
}

function Stepper({ team, value, onChange, focusRef }: {
  team: string; value: number; onChange: (v: number) => void; focusRef?: React.Ref<HTMLButtonElement>;
}) {
  const t = useT();
  const ring = { border: 1, borderColor: "divider", width: 44, height: 44, "&:active": { transform: "scale(.96)" } };
  return (
    <Box sx={{ flex: 1, textAlign: "center" }}>
      <Typography sx={{ fontSize: "1rem", lineHeight: 1.25, overflowWrap: "break-word", textWrap: "balance" }}>{team}</Typography>
      <Typography component="div" aria-live="polite" sx={{ fontFamily: NUMERAL_FONT, fontWeight: 700, fontSize: "4.5rem", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{value}</Typography>
      <Box sx={{ display: "flex", justifyContent: "center", gap: 1.5 }}>
        <IconButton ref={focusRef} aria-label={t("recapScoreLess", { team })} onClick={() => onChange(Math.max(0, value - 1))} sx={ring}><RemoveIcon /></IconButton>
        <IconButton aria-label={t("recapScoreMore", { team })} onClick={() => onChange(value + 1)} sx={ring}><AddIcon /></IconButton>
      </Box>
    </Box>
  );
}

/** Enter the result in place: a stepper per team and one Save (the History page's PATCH, no redirect). */
export function AddScoreSteppers({ eventId, historyId, teamOneName, teamTwoName, onSaved, autoFocus }: AddScoreSteppersProps) {
  const t = useT();
  const [one, setOne] = useState(0);
  const [two, setTwo] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const firstRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { if (autoFocus) firstRef.current?.focus(); }, [autoFocus]);

  const save = async () => {
    setBusy(true);
    setError(false);
    try {
      await apiRequest("PATCH /api/events/{id}/history/{historyId}", {
        params: { id: eventId, historyId },
        body: { scoreOne: one, scoreTwo: two },
      });
      onSaved(one, two);
    } catch {
      setError(true);
      setBusy(false);
    }
  };

  return (
    <Box sx={{ px: 2, pb: 2 }}>
      <Box sx={{ display: "flex", gap: 1 }}>
        <Stepper team={teamOneName} value={one} onChange={setOne} focusRef={firstRef} />
        <Stepper team={teamTwoName} value={two} onChange={setTwo} />
      </Box>
      {error && <Typography role="alert" sx={{ color: "error.main", fontSize: "0.875rem", pt: 1 }}>{t("recapScoreSaveError")}</Typography>}
      <Button
        fullWidth variant="contained" disableElevation disabled={busy} onClick={save}
        sx={{ mt: 1.5, minHeight: 52, borderRadius: 999, fontSize: "1.0625rem", fontWeight: 700, textTransform: "none" }}
      >
        {t("recapSaveScore")}
      </Button>
    </Box>
  );
}
