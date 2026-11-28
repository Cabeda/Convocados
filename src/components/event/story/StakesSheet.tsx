import { Box, Dialog, IconButton, ToggleButton, ToggleButtonGroup, Typography, useMediaQuery } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { useLocale } from "~/lib/useT";
import { OUTCOMES, type MatchOutcome } from "~/lib/stakesPreview";
import StakesPreview from "../../StakesPreview";
import type { PlayerStake } from "../../team/types";
import type { useTeamsState } from "./useTeamsState";
import { tappable } from "./styles";

type Stakes = ReturnType<typeof useTeamsState>["stakes"];

interface Props {
  open: boolean;
  onClose: () => void;
  stakes: Stakes;
  teamNames: [string, string];
  crewOf: (name: string) => string | null | undefined;
  stakeOf: (name: string) => PlayerStake | undefined;
  viewerName: string | null;
}

/**
 * "What's at stake": the season's standings under each possible result, in a dialog — a bottom sheet on a phone.
 * It is a real modal: focus moves in, Tab stays in, Esc and the close button leave, and focus goes back to the button.
 */
export function StakesSheet({ open, onClose, stakes, teamNames, crewOf, stakeOf, viewerName }: Props) {
  const { t } = useLocale();
  const calm = useMediaQuery("(prefers-reduced-motion: reduce)");
  const phone = useMediaQuery("(max-width:599.95px)");
  const data = stakes.data;
  if (!data) return null;
  const label = (outcome: MatchOutcome) =>
    outcome === "teamOne" ? t("stakesPreviewOutcomeOne", { team: teamNames[0] })
      : outcome === "teamTwo" ? t("stakesPreviewOutcomeTwo", { team: teamNames[1] }) : t("stakesPreviewOutcomeDraw");
  const mine = viewerName ? stakeOf(viewerName) : undefined;

  return (
    <Dialog
      open={open} onClose={onClose} fullWidth maxWidth="xs" aria-labelledby="stakes-title" transitionDuration={calm ? 0 : undefined}
      slotProps={{
        paper: { sx: phone ? { position: "fixed", bottom: 0, m: 0, width: "100%", maxWidth: "32rem", borderRadius: "20px 20px 0 0", pb: "env(safe-area-inset-bottom)" } : { borderRadius: "20px" } },
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", pl: 2.5, pr: 0.5, pt: 1 }}>
        <Typography id="stakes-title" component="h2" sx={{ fontSize: "1.0625rem", fontWeight: 700 }}>{t("stakesPreviewTitle")}</Typography>
        <IconButton aria-label={t("ngCloseAria")} onClick={onClose} sx={{ width: 44, height: 44, ...tappable }}><CloseIcon /></IconButton>
      </Box>
      <Box sx={{ px: 2.5, pb: 2.5 }}>
        {data.roundAvailable && stakes.scenario && (
          <ToggleButtonGroup
            exclusive fullWidth size="small" value={stakes.scenarioIndex} aria-label={t("stakesPreviewTitle")}
            onChange={(_e, next) => { if (next !== null) stakes.setScenarioIndex(next); }} sx={{ my: 1.5 }}
          >
            {OUTCOMES.map((outcome, index) => (
              <ToggleButton key={outcome} value={index} sx={{ minHeight: 44, textTransform: "none", fontWeight: 700, lineHeight: 1.2 }}>{label(outcome)}</ToggleButton>
            ))}
          </ToggleButtonGroup>
        )}
        <StakesPreview seasonName={data.seasonName} roundAvailable={data.roundAvailable} roundsCounted={data.roundsCounted} scenario={stakes.scenario} liveRoundScore={stakes.liveCrewScore} />
        {mine && data.rankEnabled && (
          <Typography data-testid="stakes-you" sx={{ mt: 1.5, fontSize: "1rem" }}>
            {mine.provisional ? t("seasonRankProvisional") : t("stakesPreviewRankDelta", { delta: `${mine.rpDelta > 0 ? "+" : ""}${mine.rpDelta}` })}
            {" · "}{t("stakesPreviewPts", { n: mine.contribution })}
          </Typography>
        )}
        {stakes.scenario && (
          <Box component="ul" sx={{ listStyle: "none", m: 0, mt: 1.5, p: 0 }}>
            {stakes.scenario.players.map((p) => (
              <Box component="li" key={p.name} sx={{ display: "flex", justifyContent: "space-between", gap: 1, minHeight: 32, alignItems: "center", fontSize: "1rem" }}>
                <span>{p.name}{crewOf(p.name) ? <Box component="span" sx={{ color: "text.secondary" }}> · {crewOf(p.name)}</Box> : null}</span>
                <Box component="span" sx={{ color: "text.secondary", fontVariantNumeric: "tabular-nums" }}>{t("stakesPreviewPts", { n: stakeOf(p.name)?.contribution ?? p.contribution })}</Box>
              </Box>
            ))}
          </Box>
        )}
      </Box>
    </Dialog>
  );
}
