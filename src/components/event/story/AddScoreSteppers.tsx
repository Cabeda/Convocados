import { useEffect, useRef, useState } from "react";
import { Box, Button, IconButton, Typography } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import RemoveIcon from "@mui/icons-material/Remove";
import { useT } from "~/lib/useT";
import { BOARD_MAX_WIDTH, NUMERAL_FONT, PANEL_ACTION_HEIGHT, ACTION_HEIGHT, tappable } from "./styles";

export interface AddScoreSteppersProps {
  /** Id the "Add score" toggle points at (aria-controls). */
  panelId: string;
  teamOneName: string;
  teamTwoName: string;
  /** Start from these numbers (the viewer's own, after a failed save). */
  initial?: [number, number];
  /** Show the "couldn't save" line straight away (a save the server refused). */
  startError?: boolean;
  /** The viewer taps Save. The parent saves it and shows the result at once. */
  onSave: (scoreOne: number, scoreTwo: number) => void;
  /** The viewer taps Not now. */
  onCancel: () => void;
}

function Stepper({ team, value, onChange, focusRef }: {
  team: string; value: number; onChange: (v: number) => void; focusRef?: React.Ref<HTMLButtonElement>;
}) {
  const t = useT();
  const ring = { border: 1, borderColor: "divider", width: 48, height: 48, ...tappable };
  return (
    <Box sx={{ minWidth: 0, textAlign: "center" }}>
      <Typography sx={{ fontSize: "1rem", lineHeight: 1.25, overflowWrap: "break-word", textWrap: "balance", fontWeight: 700 }}>{team}</Typography>
      <Typography component="div" aria-live="polite" sx={{ fontFamily: NUMERAL_FONT, fontWeight: 700, fontSize: "4.5rem", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{value}</Typography>
      <Box sx={{ display: "flex", justifyContent: "center", gap: 1.5 }}>
        <IconButton ref={focusRef} aria-label={t("recapScoreLess", { team })} onClick={() => onChange(Math.max(0, value - 1))} sx={ring}><RemoveIcon /></IconButton>
        <IconButton aria-label={t("recapScoreMore", { team })} onClick={() => onChange(value + 1)} sx={ring}><AddIcon /></IconButton>
      </Box>
    </Box>
  );
}

/**
 * Enter the result in place. While it is open it IS the scoreboard (so the team
 * names and the numbers are said once, not twice): a stepper per team, one Save
 * and a Not now. Saving 0–0 asks for one more tap, because it is usually a slip.
 */
export function AddScoreSteppers({ panelId, teamOneName, teamTwoName, initial, startError, onSave, onCancel }: AddScoreSteppersProps) {
  const t = useT();
  const [one, setOne] = useState(initial?.[0] ?? 0);
  const [two, setTwo] = useState(initial?.[1] ?? 0);
  const [confirmZero, setConfirmZero] = useState(false);
  const firstRef = useRef<HTMLButtonElement>(null);

  // Opening the panel puts the keyboard where the work is.
  useEffect(() => { firstRef.current?.focus(); }, []);

  const change = (set: (v: number) => void) => (v: number) => { set(v); setConfirmZero(false); };
  const save = () => {
    if (one === 0 && two === 0 && !confirmZero) { setConfirmZero(true); return; }
    onSave(one, two);
  };

  return (
    <Box id={panelId} role="group" aria-label={t("recapAddScoreTitle")} sx={{ maxWidth: BOARD_MAX_WIDTH, mx: "auto" }}>
      <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: 1.5 }}>
        <Stepper team={teamOneName} value={one} onChange={change(setOne)} focusRef={firstRef} />
        <Stepper team={teamTwoName} value={two} onChange={change(setTwo)} />
      </Box>
      {startError && <Typography role="alert" sx={{ color: "error.main", fontSize: "0.9375rem", pt: 1 }}>{t("recapScoreSaveError")}</Typography>}
      <Box sx={{ display: "flex", gap: 1, mt: 1.5, alignItems: "center" }}>
        <Button
          variant="contained" disableElevation onClick={save}
          sx={{ flex: 1, minHeight: PANEL_ACTION_HEIGHT, borderRadius: 999, fontSize: "1.0625rem", fontWeight: 700, textTransform: "none", ...tappable }}
        >
          {confirmZero ? t("recapSaveZeroConfirm") : t("recapSaveScore")}
        </Button>
        <Button onClick={onCancel} sx={{ minHeight: ACTION_HEIGHT, minWidth: 44, borderRadius: 999, px: 2, fontWeight: 700, textTransform: "none", ...tappable }}>
          {t("recapNotNow")}
        </Button>
      </Box>
    </Box>
  );
}
