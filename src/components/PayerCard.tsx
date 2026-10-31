import { useCallback, useEffect, useState } from "react";
import { Alert, Box, Button, Chip, Stack, Typography } from "@mui/material";
import PaymentsIcon from "@mui/icons-material/Payments";
import { useT } from "~/lib/useT";
import { apiRequest } from "~/lib/api/client";

interface PayerState {
  gameId: string | null;
  mode: "tracked" | "untracked";
  hasCost: boolean;
  payerName: string | null;
  isPayer: boolean;
  isRosterPlayer: boolean;
  vacant: boolean;
}

/**
 * Who is collecting for this Game, before it is played (ADR 0055).
 *
 * The role is a chore, not a privilege: a roster player can take it, and whoever
 * holds it can withdraw for one Game, which leaves it Vacant for anyone else.
 */
export function PayerCard({ eventId }: { eventId: string }) {
  const t = useT();
  const [state, setState] = useState<PayerState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      apiRequest("GET /api/events/{id}/payments/payer", { params: { id: eventId } })
        .then((body) => setState(body as unknown as PayerState))
        .catch(() => setState(null)),
    [eventId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (action: "claim" | "stand-down") => {
    setBusy(true);
    setError(null);
    try {
      if (action === "claim") {
        await apiRequest("POST /api/events/{id}/payments/payer/claim", { params: { id: eventId }, body: {} });
      } else {
        await apiRequest("POST /api/events/{id}/payments/payer/stand-down", { params: { id: eventId }, body: {} });
      }
      await load();
    } catch {
      setError(t("payerCardError"));
    } finally {
      setBusy(false);
    }
  };

  if (!state || state.mode === "untracked" || !state.hasCost) return null;

  return (
    <Box sx={{ pt: 1, borderTop: "1px dashed rgba(0,0,0,0.12)" }}>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
        <PaymentsIcon fontSize="small" color="action" />
        {state.vacant || !state.payerName ? (
          <>
            <Typography variant="body2" color="text.secondary">{t("payerCardVacant")}</Typography>
            {state.isRosterPlayer && (
              <Chip
                size="small"
                color="primary"
                label={t("payerCardClaim")}
                onClick={() => !busy && act("claim")}
                clickable
              />
            )}
          </>
        ) : (
          <>
            <Typography variant="body2" fontWeight={600}>
              {t("payerCardCollecting", { name: state.payerName })}
            </Typography>
            {state.isPayer && (
              <Button size="small" onClick={() => act("stand-down")} disabled={busy}>
                {t("payerCardStandDown")}
              </Button>
            )}
            {!state.isPayer && state.isRosterPlayer && (
              <Button size="small" onClick={() => act("claim")} disabled={busy}>
                {t("payerCardClaim")}
              </Button>
            )}
          </>
        )}
      </Stack>
      {error && <Alert severity="error" sx={{ mt: 1 }}>{error}</Alert>}
    </Box>
  );
}
