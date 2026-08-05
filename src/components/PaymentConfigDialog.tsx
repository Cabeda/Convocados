import { useState, useEffect } from "react";
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Typography, Stack,
  TextField, Select, MenuItem, FormControl, InputLabel, RadioGroup,
  FormControlLabel, Radio, Button, Alert,
} from "@mui/material";
import { useT } from "~/lib/useT";

export interface PaymentConfigGame {
  gameId: string;
  mode: "tracked" | "untracked";
  payerName: string | null;
  payerIsPlayer: boolean;
  hasCost?: boolean;
  rows: Array<{ eventPlayerId: string; name: string; amount: number; status: string; isPayer: boolean }>;
}

/**
 * Shared "Who paid this game?" dialog — sets a game's payment mode + payer.
 * Used by the payments page and the event page payment section.
 */
export function PaymentConfigDialog({
  open, eventId, game, onClose, onSaved,
}: {
  open: boolean;
  eventId: string;
  game: PaymentConfigGame | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const t = useT();
  const [mode, setMode] = useState<"tracked" | "untracked">("tracked");
  const [payerKind, setPayerKind] = useState<"player" | "external">("player");
  const [payerEventPlayerId, setPayerEventPlayerId] = useState("");
  const [payerExternalName, setPayerExternalName] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Initialise only when the target game changes — not on every poll refetch
  // (the parent re-fetches the same game, producing a new object each time).
  const gameId = game?.gameId ?? null;
  useEffect(() => {
    if (!game) return;
    setMode(game.mode);
    const playerPayer = game.rows.find((r) => r.isPayer);
    if (playerPayer) {
      setPayerKind("player");
      setPayerEventPlayerId(playerPayer.eventPlayerId);
      setPayerExternalName("");
    } else if (game.payerName) {
      setPayerKind("external");
      setPayerExternalName(game.payerName);
      setPayerEventPlayerId("");
    } else {
      setPayerKind("player");
      setPayerEventPlayerId("");
      setPayerExternalName("");
    }
    setErr(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId]);

  if (!game) return null;

  const save = async () => {
    setSaving(true);
    setErr(null);
    try {
      const body: Record<string, unknown> = { gameId: game.gameId, mode };
      if (mode === "tracked") {
        if (payerKind === "player") {
          body.payerEventPlayerId = payerEventPlayerId;
        } else {
          body.payerExternalName = payerExternalName.trim();
        }
      }
      const res = await fetch(`/api/events/${eventId}/payments/config`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        setErr(j?.error ?? "failed");
        return;
      }
      await onSaved();
    } catch {
      setErr("failed");
    } finally {
      setSaving(false);
    }
  };

  const playerOptions = game.rows;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t("paymentsConfigTitle")}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" mb={2}>{t("paymentsConfigHint")}</Typography>

        <RadioGroup value={mode} onChange={(e) => setMode(e.target.value as "tracked" | "untracked")}>
          <FormControlLabel value="tracked" control={<Radio />} label={t("paymentsModeTracked")} />
          <FormControlLabel value="untracked" control={<Radio />} label={t("paymentsModeUntracked")} />
        </RadioGroup>

        {mode === "tracked" && (
          <Stack spacing={2} sx={{ mt: 2 }}>
            <RadioGroup value={payerKind} onChange={(e) => setPayerKind(e.target.value as "player" | "external")}>
              <FormControlLabel value="player" control={<Radio />} label={t("paymentsPayerPlayer")} />
              <FormControlLabel value="external" control={<Radio />} label={t("paymentsPayerExternal")} />
            </RadioGroup>

            {payerKind === "player" ? (
              <FormControl fullWidth>
                <InputLabel>{t("paymentsPayerPlayer")}</InputLabel>
                <Select
                  value={payerEventPlayerId}
                  label={t("paymentsPayerPlayer")}
                  onChange={(e) => setPayerEventPlayerId(e.target.value as string)}
                >
                  {playerOptions.map((r) => (
                    <MenuItem key={r.eventPlayerId} value={r.eventPlayerId}>{r.name}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            ) : (
              <TextField
                fullWidth
                label={t("paymentsPayerExternalPlaceholder")}
                value={payerExternalName}
                onChange={(e) => setPayerExternalName(e.target.value)}
              />
            )}
          </Stack>
        )}

        {err && <Alert severity="error" sx={{ mt: 2 }}>{err === "failed" ? t("paymentsFailed") : err}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("paymentsCancel")}</Button>
        <Button variant="contained" disabled={saving} onClick={save}>{t("paymentsSave")}</Button>
      </DialogActions>
    </Dialog>
  );
}
