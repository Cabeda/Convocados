import { useEffect, useMemo, useRef, useState } from "react";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Chip,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  alpha,
  useTheme,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import GroupsIcon from "@mui/icons-material/Groups";
import { useT } from "~/lib/useT";
import type { MatchOutcome, StakesScenario } from "~/lib/stakesPreview";

interface LineupPlayer {
  name: string;
  side: "teamOne" | "teamTwo";
  crewId: string | null;
  crewName: string | null;
  participant: boolean;
}

interface Payload {
  seasonId: string;
  seasonName: string;
  rankEnabled: boolean;
  roundAvailable: boolean;
  roundsCounted: number;
  lineup: LineupPlayer[];
  scenarios: StakesScenario[];
}

const CREW_COLORS = ["#5b8def", "#e0629b", "#3fa8a0", "#c9a227", "#9b6bff", "#ef6c50", "#4db6ac", "#f06292"];

function crewColor(crewId: string): string {
  let hash = 0;
  for (let i = 0; i < crewId.length; i++) hash = (hash * 31 + crewId.charCodeAt(i)) >>> 0;
  return CREW_COLORS[hash % CREW_COLORS.length];
}

export interface StakesPreviewProps {
  eventId: string;
  teamOne: string[];
  teamTwo: string[];
  teamOneName: string;
  teamTwoName: string;
}

/**
 * Stakes Preview (ADR 0050): the projected Season outcome of the unplayed Game,
 * for participants only. Collapsed by default, colour-coded by Crew, and always
 * useful without dominating the ordinary weekly game.
 */
export function StakesPreview({ eventId, teamOne, teamTwo, teamOneName, teamTwoName }: StakesPreviewProps) {
  const t = useT();
  const theme = useTheme();
  const [payload, setPayload] = useState<Payload | null>(null);
  const [scenarioIndex, setScenarioIndex] = useState(0);
  const lineupKey = useMemo(() => JSON.stringify([teamOne, teamTwo]), [teamOne, teamTwo]);
  const abortRef = useRef<AbortController | null>(null);
  const hasLineups = teamOne.length > 0 && teamTwo.length > 0;

  useEffect(() => {
    if (!hasLineups) return;
    // Debounce so a burst of drags resolves to one request for the settled lineups.
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      abortRef.current?.abort();
      abortRef.current = controller;
      try {
        const res = await fetch(`/api/events/${eventId}/stakes-preview`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ teamOne, teamTwo }),
          signal: controller.signal,
        });
        if (!res.ok) {
          setPayload(null);
          return;
        }
        const data = (await res.json()) as { active: boolean; preview?: Payload };
        setPayload(data.active && data.preview ? data.preview : null);
      } catch {
        /* aborted or offline — leave the last projection in place */
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps, @eslint-react/exhaustive-deps
  }, [eventId, lineupKey, hasLineups]);

  if (!hasLineups || !payload) return null;

  const scenario = payload.scenarios[scenarioIndex] ?? payload.scenarios[0];
  const outcomeLabel: Record<MatchOutcome, string> = {
    teamOne: t("stakesPreviewOutcomeOne", { team: teamOneName || t("stakesPreviewTeamOne") }),
    draw: t("stakesPreviewOutcomeDraw"),
    teamTwo: t("stakesPreviewOutcomeTwo", { team: teamTwoName || t("stakesPreviewTeamTwo") }),
  };

  const contributionChip = (points: number) => {
    const color = points === 3 ? theme.palette.success.main : points === 1 ? theme.palette.warning.main : theme.palette.text.disabled;
    return (
      <Chip
        size="small"
        label={t("stakesPreviewPts", { n: points })}
        sx={{
          height: 20,
          fontWeight: 800,
          fontVariantNumeric: "tabular-nums",
          color,
          bgcolor: alpha(color, 0.14),
          border: `1px solid ${alpha(color, 0.4)}`,
        }}
      />
    );
  };

  const movementChip = (rpDelta: number, passed: number) => {
    const up = passed > 0;
    const down = passed < 0;
    return (
      <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
        <Chip
          size="small"
          label={t("stakesPreviewRankDelta", { delta: `${rpDelta > 0 ? "+" : ""}${rpDelta}` })}
          sx={{ height: 20, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}
        />
        {(up || down) && (
          <Chip
            size="small"
            icon={up ? <ArrowUpwardIcon /> : <ArrowDownwardIcon />}
            label={Math.abs(passed)}
            sx={{
              height: 20,
              fontWeight: 800,
              color: up ? theme.palette.success.main : theme.palette.error.main,
              bgcolor: alpha(up ? theme.palette.success.main : theme.palette.error.main, 0.14),
              "& .MuiChip-icon": { color: "inherit", fontSize: 14 },
            }}
          />
        )}
      </Stack>
    );
  };

  const sidePanel = (side: "teamOne" | "teamTwo", label: string) => {
    const players = scenario?.players.filter((p) => p.side === side) ?? [];
    return (
      <Box
        sx={{
          flex: 1,
          minWidth: 0,
          p: 1.5,
          borderRadius: 2,
          bgcolor: alpha(side === "teamOne" ? theme.palette.primary.main : theme.palette.secondary.main, 0.05),
        }}
      >
        <Typography variant="subtitle2" fontWeight={800} sx={{ mb: 1 }}>
          {label}
        </Typography>
        <Stack spacing={0.75}>
          {players.map((p) => (
            <Box key={p.name} sx={{ display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap" }}>
              <Typography variant="body2" sx={{ fontWeight: 600, flex: 1, minWidth: 60 }}>
                {p.name}
              </Typography>
              {p.crewName ? (
                <Chip
                  size="small"
                  icon={<GroupsIcon />}
                  label={p.crewName}
                  sx={{
                    height: 20,
                    fontWeight: 700,
                    color: crewColor(p.crewId ?? p.crewName),
                    bgcolor: alpha(crewColor(p.crewId ?? p.crewName), 0.14),
                    "& .MuiChip-icon": { color: "inherit", fontSize: 13 },
                  }}
                />
              ) : (
                <Chip size="small" label={t("stakesPreviewFreeAgent")} sx={{ height: 20, color: "text.secondary" }} />
              )}
              {contributionChip(p.contribution)}
              {payload.rankEnabled &&
                (p.provisional ? (
                  <Chip size="small" label={t("seasonRankProvisional")} sx={{ height: 20, color: "text.secondary" }} />
                ) : (
                  movementChip(p.rpDelta, p.passed)
                ))}
            </Box>
          ))}
        </Stack>
      </Box>
    );
  };

  return (
    <Accordion
      disableGutters
      data-testid="stakes-preview"
      sx={{ borderRadius: 2, "&:before": { display: "none" }, bgcolor: "action.hover" }}
    >
      <AccordionSummary expandIcon={<ExpandMoreIcon />} aria-controls="stakes-preview-content">
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0 }}>
          <Typography variant="subtitle2" fontWeight={800}>
            {t("stakesPreviewTitle")}
          </Typography>
          <Typography variant="caption" color="text.secondary" noWrap>
            {payload.seasonName}
          </Typography>
        </Box>
      </AccordionSummary>
      <AccordionDetails id="stakes-preview-content">
        {!payload.roundAvailable ? (
          <Typography variant="body2" color="text.secondary">
            {t("stakesPreviewNoRound", { n: payload.roundsCounted })}
          </Typography>
        ) : (
          <Stack spacing={1.5}>
            <ToggleButtonGroup
              size="small"
              exclusive
              fullWidth
              value={scenarioIndex}
              onChange={(_e, next) => { if (next !== null) setScenarioIndex(next); }}
              aria-label={t("stakesPreviewTitle")}
            >
              {(["teamOne", "draw", "teamTwo"] as MatchOutcome[]).map((outcome, index) => (
                <ToggleButton key={outcome} value={index} sx={{ textTransform: "none", fontWeight: 700 }}>
                  {outcomeLabel[outcome]}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>

            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
              {sidePanel("teamOne", teamOneName || t("stakesPreviewTeamOne"))}
              {sidePanel("teamTwo", teamTwoName || t("stakesPreviewTeamTwo"))}
            </Stack>

            <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap" }}>
              <Typography variant="caption" fontWeight={700} color="text.secondary">
                {t("stakesPreviewCrewsTitle")}
              </Typography>
              {(scenario?.crews ?? []).map((c) => {
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
                        <Box component="span" sx={{ fontWeight: 800 }}>
                          {t("stakesPreviewPts", { n: c.roundScore })}
                        </Box>
                        <Box component="span" sx={{ color: "text.secondary" }}>
                          {t("stakesPreviewCrewPlace", { place: c.positionAfter })}
                        </Box>
                        {(up || down) && (
                          <Box component="span" sx={{ fontWeight: 800, color: up ? "success.main" : "error.main" }}>
                            {up ? "▲" : "▼"}
                            {Math.abs(c.passed)}
                          </Box>
                        )}
                      </Box>
                    }
                    sx={{
                      height: 22,
                      color: crewColor(c.crewId),
                      bgcolor: alpha(crewColor(c.crewId), 0.12),
                      "& .MuiChip-icon": { color: "inherit", fontSize: 14 },
                    }}
                  />
                );
              })}
            </Box>
          </Stack>
        )}
      </AccordionDetails>
    </Accordion>
  );
}

export default StakesPreview;
