import { useEffect, useRef } from "react";
import { Alert, Box, Button, Typography } from "@mui/material";
import { useLocale } from "~/lib/useT";
import { playAgainView } from "~/lib/teamsView";
import { PageSection } from "./PageSection";
import { ACTION_HEIGHT, tappable } from "./styles";

interface Props {
  canManage: boolean;
  ownerName: string | null;
  busy: boolean;
  error: string | null;
  onMakeWeekly: () => void;
  onDismissError: () => void;
}

/**
 * What a one-off game offers once it has ended, instead of a next game: "Play again?". The people who run it
 * choose (make it weekly, or plan another); everyone else is told who to ask. Flat on the page, no card.
 */
export function PlayAgain({ canManage, ownerName, busy, error, onMakeWeekly, onDismissError }: Props) {
  const { t } = useLocale();
  const view = playAgainView({ canManage, ownerName });
  const weeklyRef = useRef<HTMLButtonElement>(null);
  // After a refusal the page is back as it was: focus returns to the button that was pressed.
  useEffect(() => { if (error) weeklyRef.current?.focus(); }, [error]);

  return (
    <PageSection gap="major" aria-labelledby="play-again-heading" data-testid="play-again">
      <Typography id="play-again-heading" component="h2" sx={{ fontSize: "1.25rem", fontWeight: 700, lineHeight: 1.3, textWrap: "balance" }}>{t("paTitle")}</Typography>
      {view.kind === "manage" ? (
        <>
          <Typography sx={{ mt: 0.5, fontSize: "1rem", lineHeight: 1.45, color: "text.secondary", textWrap: "pretty" }}>{t("paManage")}</Typography>
          {error && <Alert severity="error" onClose={onDismissError} sx={{ mt: 1.5 }}>{error}</Alert>}
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1, mt: 1.5 }}>
            <Button
              ref={weeklyRef} variant="contained" disableElevation disabled={busy} aria-busy={busy || undefined} onClick={onMakeWeekly}
              sx={{ minHeight: 56, borderRadius: 999, textTransform: "none", fontSize: "1.0625rem", fontWeight: 700, ...tappable }}
            >
              {t("recurrenceMakeWeekly")}
            </Button>
            <Button
              href="/" variant="outlined"
              sx={{ minHeight: ACTION_HEIGHT, borderRadius: 999, textTransform: "none", fontWeight: 700, color: "text.primary", borderColor: (th) => th.palette.divider, ...tappable }}
            >
              {t("paPlanAnother")}
            </Button>
          </Box>
        </>
      ) : (
        <Typography sx={{ mt: 0.5, fontSize: "1rem", lineHeight: 1.45, color: "text.secondary", textWrap: "pretty" }}>
          {view.owner ? t("paAsk", { owner: view.owner }) : t("paAskNobody")}
        </Typography>
      )}
    </PageSection>
  );
}
