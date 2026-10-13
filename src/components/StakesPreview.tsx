import { Box, Chip, Stack, Typography, alpha } from "@mui/material";
import GroupsIcon from "@mui/icons-material/Groups";
import { useT } from "~/lib/useT";
import { crewColor } from "~/lib/crewColors";
import type { StakesScenario } from "~/lib/stakesPreview";

export interface StakesPreviewProps {
  seasonName: string;
  roundAvailable: boolean;
  roundsCounted: number;
  /** The selected side-result scenario; null before data arrives. */
  scenario: StakesScenario | null;
  /** Live round score per Crew, derived client-side while teams are dragged. */
  liveRoundScore?: Record<string, number>;
}

/**
 * The Crew standings race for the projected Game (ADR 0050). Slim by design —
 * the per-player Crew association, contributions and movement live inline on the
 * team panels; this strip shows only the one thing that is not per-player: where
 * each Crew would sit in the table under the selected result.
 */
export function StakesPreview({ seasonName, roundAvailable, roundsCounted, scenario, liveRoundScore }: StakesPreviewProps) {
  const t = useT();

  if (!roundAvailable) {
    return (
      <Typography variant="caption" color="text.secondary" data-testid="stakes-preview-no-round">
        {t("stakesPreviewNoRound", { n: roundsCounted })}
      </Typography>
    );
  }
  if (!scenario) return null;

  const crews = [...scenario.crews].sort((a, b) => a.positionAfter - b.positionAfter);

  return (
    <Box data-testid="stakes-preview" sx={{ display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap" }}>
      <Typography variant="caption" fontWeight={700} color="text.secondary">
        {t("stakesPreviewCrewsTitle")}
      </Typography>
      <Typography variant="caption" color="text.disabled" noWrap>
        {seasonName}
      </Typography>
      <Stack direction="row" spacing={0.75} sx={{ flexWrap: "wrap" }}>
        {crews.map((c) => {
          const color = crewColor(c.crewId);
          const score = liveRoundScore?.[c.crewId] ?? c.roundScore;
          const up = c.passed > 0;
          const down = c.passed < 0;
          return (
            <Chip
              key={c.crewId}
              size="small"
              icon={<GroupsIcon />}
              label={
                <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
                  {c.name}
                  <Box component="span" sx={{ fontWeight: 800 }}>{t("stakesPreviewPts", { n: Math.round(score) })}</Box>
                  <Box component="span" sx={{ color: "text.secondary" }}>
                    {t("stakesPreviewCrewPlace", { place: c.positionAfter })}
                  </Box>
                  {(up || down) && (
                    <Box component="span" sx={{ fontWeight: 800, color: up ? "success.main" : "error.main" }}>
                      {up ? "▲" : "▼"}{Math.abs(c.passed)}
                    </Box>
                  )}
                </Box>
              }
              sx={{
                height: 22,
                color,
                bgcolor: alpha(color, 0.12),
                "& .MuiChip-icon": { color: "inherit", fontSize: 14 },
              }}
            />
          );
        })}
      </Stack>
    </Box>
  );
}

export default StakesPreview;
