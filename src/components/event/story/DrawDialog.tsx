import { useState } from "react";
import {
  Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, FormControlLabel, Radio, RadioGroup,
} from "@mui/material";
import { useLocale } from "~/lib/useT";
import { tappable } from "./styles";

interface Props {
  /** `early`: the list is not full. `redraw`: teams exist and would be replaced. Null: closed. */
  step: "early" | "redraw" | null;
  /** How many are in (for the early draw). */
  count: number;
  /** Offer "even teams or random": only for a game that keeps ratings. */
  canBalance: boolean;
  /** What the event does by default: the choice starts there. */
  balancedDefault: boolean;
  onClose: () => void;
  onConfirm: (balanced: boolean) => void;
}

/** Asks before teams are replaced or drawn from a short list, in plain words; a game with ratings also asks how. */
export function DrawDialog({ step, count, canBalance, balancedDefault, onClose, onConfirm }: Props) {
  const { t } = useLocale();
  const [how, setHow] = useState<"even" | "random" | null>(null);
  const chosen = how ?? (balancedDefault ? "even" : "random");
  return (
    <Dialog open={step !== null} onClose={onClose} aria-labelledby="draw-title" slotProps={{ transition: { onExited: () => setHow(null) } }}>
      <DialogTitle id="draw-title">{step === "redraw" ? t("tbRedrawTitle") : t("tbEarlyTitle")}</DialogTitle>
      <DialogContent>
        <DialogContentText>{step === "redraw" ? t("tbRedrawBody") : t("tbEarlyBody", { n: count })}</DialogContentText>
        {canBalance && (
          <RadioGroup aria-label={t("tbHow")} value={chosen} onChange={(e) => setHow(e.target.value as "even" | "random")} sx={{ mt: 1 }}>
            <FormControlLabel value="even" control={<Radio />} label={t("tbHowEven")} sx={{ minHeight: 44 }} />
            <FormControlLabel value="random" control={<Radio />} label={t("tbHowRandom")} sx={{ minHeight: 44 }} />
          </RadioGroup>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} sx={{ minHeight: 44, ...tappable }}>{t("cancel")}</Button>
        <Button variant="contained" onClick={() => onConfirm(chosen === "even")} sx={{ minHeight: 44, ...tappable }}>
          {step === "redraw" ? t("ngDrawAgain") : t("tbDrawConfirm")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
