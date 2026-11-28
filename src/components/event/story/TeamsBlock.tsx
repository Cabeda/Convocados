import { useMemo, useState } from "react";
import { Box, Button, Typography, useMediaQuery } from "@mui/material";
import ShuffleIcon from "@mui/icons-material/Shuffle";
import { useLocale } from "~/lib/useT";
import { formatDateInTz } from "~/lib/timezones";
import { drawGate, drawStep, showRatings, viewerTeamIndex } from "~/lib/teamsView";
import { findSelfRosterRow, type EventPermissions } from "~/lib/eventView";
import { TeamField } from "../../TeamField";
import type { EventData } from "../types";
import { DrawDialog } from "./DrawDialog";
import { PageSection } from "./PageSection";
import { StakesSheet } from "./StakesSheet";
import { TeamColumns } from "./TeamColumns";
import { EASE, controlBorder, motion, srOnly, tappable } from "./styles";
import { useTeamsReveal } from "./useTeamsReveal";
import { useTeamsState } from "./useTeamsState";

const CALM = "@media (prefers-reduced-motion: reduce)";

interface Props {
  event: EventData;
  perms: EventPermissions;
  viewer: { id: string; name: string } | null;
  refetch: () => Promise<void>;
  notify: (message: string) => void;
  /** The game's date (for "Teams for Friday") and whether it is today. */
  date: Date;
  gameDay: boolean;
  /** How many are in the lineup (not on the bench). */
  count: number;
}

/**
 * Teams for the next game, flat inside the Next game block. Rendered only while the game is open or being played:
 * between a weekly game's end and its reset the teams are still the finished game's, and this block is not drawn.
 * Players see the teams once they exist; the organizer also gets "Draw teams now" / "Draw again".
 */
export function TeamsBlock({ event, perms, viewer, refetch, notify, date, gameDay, count }: Props) {
  const { t, locale } = useLocale();
  const teams = useTeamsState({ event, refetch, notify, failed: { teams: t("tbSaveFailed"), names: t("tbRenameFailed"), draw: t("somethingWentWrong") } });
  const matches = teams.matches;
  const hasTeams = !!matches && matches.length > 0;
  // The server's word decides when teams appear, not the copy this block keeps for a move in flight.
  const { reveal, announce } = useTeamsReveal(event.teamResults.length > 0);
  const pointerFine = useMediaQuery("(pointer: fine)");
  const [view, setView] = useState<"list" | "field">("list");
  const [step, setStep] = useState<"early" | "redraw" | null>(null);
  const [stakesOpen, setStakesOpen] = useState(false);
  const [renamed, setRenamed] = useState<string | null>(null);

  const row = findSelfRosterRow(event.players, viewer);
  const viewerTeam = useMemo(
    () => (matches ? viewerTeamIndex(matches.map((m) => ({ members: m.players })), event.players, viewer) : null),
    [matches, event.players, viewer],
  );
  const stakes = teams.stakes;
  const ratings = showRatings(event) ? teams.ratings : undefined;
  const crews = useMemo(() => {
    // Only when the server sent stakes for this lineup, and only the people it put in a crew.
    if (!stakes.hasLineups || !stakes.data) return undefined;
    const map: Record<string, string | null> = {};
    for (const [name, crew] of Object.entries(stakes.crewMap)) if (crew?.crewName) map[name] = crew.crewName;
    return Object.keys(map).length > 0 ? map : undefined;
  }, [stakes.hasLineups, stakes.data, stakes.crewMap]);
  const positions = useMemo(() => {
    if (!event.positionsEnabled) return undefined;
    const map: Record<string, string | null | undefined> = {};
    for (const p of event.players) map[p.name] = p.position;
    return map;
  }, [event.positionsEnabled, event.players]);

  const gate = drawGate(count);
  const canDraw = perms.canEditSettings;
  const startDraw = () => {
    const next = drawStep({ hasTeams, count, max: event.maxPlayers });
    if (next === "now") void runDraw(event.balanced); else setStep(next);
  };
  const runDraw = async (balanced: boolean) => {
    setStep(null);
    setRenamed(null);
    await teams.draw(balanced);
  };

  const heading = gameDay ? t("tbTeamsToday") : t("tbTeamsFor", { day: formatDateInTz(date, locale, event.timezone, { weekday: "long" }) });
  const full = count >= event.maxPlayers;
  const status = renamed ?? (announce ? t("tbReady") : "");
  const outcomeTeams: [string, string] = [teams.names.one, teams.names.two];

  return (
    <>
      {/* Always there, so a screen reader hears the text when it arrives: a region that appears with its text is often missed. */}
      <Box role="status" aria-live="polite" data-testid="teams-announcement" sx={srOnly}>{status}</Box>
      {(hasTeams || canDraw) && (
      <PageSection
        gap="nested" aria-labelledby={hasTeams ? "teams-heading" : undefined} aria-label={hasTeams ? undefined : t("tbTeams")}
        data-testid="teams" data-reveal={reveal ? "true" : undefined}
      >

        {hasTeams && (
          <Box
            sx={{
              display: "grid", gridTemplateRows: "1fr",
              ...(reveal ? {
                overflow: "hidden", animation: `tbUnfold 280ms ${EASE} both`,
                "@keyframes tbUnfold": { from: { gridTemplateRows: "0fr", opacity: 0 }, to: { gridTemplateRows: "1fr", opacity: 1 } },
                [CALM]: { animation: "none" },
              } : {}),
            }}
          >
            <Box sx={{ minHeight: 0 }}>
              <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
                <Typography id="teams-heading" component="h3" sx={{ fontSize: "1rem", lineHeight: 1.4, color: "text.secondary", textWrap: "balance" }}>{heading}</Typography>
                <Button
                  onClick={() => setView((v) => (v === "list" ? "field" : "list"))}
                  sx={{ minHeight: 44, mr: -1, px: 1.5, borderRadius: 999, textTransform: "none", fontSize: "1rem", fontWeight: 600, color: "text.primary", flex: "none", ...tappable }}
                >
                  {view === "list" ? t("tbPitchView") : t("teamViewList")}
                </Button>
              </Box>
              {!full && (
                <Typography data-testid="teams-drawn-early" sx={{ fontSize: "0.9375rem", lineHeight: 1.4, color: "text.secondary", textWrap: "pretty" }}>
                  {t("tbDrawnEarly", { n: count, max: event.maxPlayers })}
                </Typography>
              )}
              {view === "list" ? (
                <TeamColumns
                  matches={matches} viewerTeam={viewerTeam} viewerName={row?.name ?? null} canEdit={perms.canEditTeams} drag={pointerFine}
                  onResultChange={(next) => void teams.save(next)} shuffleKey={teams.shuffleVersion} reveal={reveal}
                  ratings={ratings} crews={crews} positions={positions}
                  onRename={perms.canEditSettings ? async (index, name) => {
                    if (await teams.rename(index, name)) setRenamed(t("tbRenamed", { name }));
                  } : undefined}
                />
              ) : (
                <Box sx={{ mt: 1 }}>
                  <TeamField
                    matches={matches} onResultChange={(next) => void teams.save(next)} shuffleKey={teams.shuffleVersion} ratingsMap={ratings}
                    sport={event.sport} canEdit={perms.canEditTeams}
                    crewMap={stakes.hasLineups ? stakes.crewMap : undefined} crewChipsByTeamIndex={stakes.crewChips}
                  />
                </Box>
              )}
              {stakes.data && (
                <Button
                  onClick={() => setStakesOpen(true)} aria-haspopup="dialog"
                  sx={{ mt: 0.5, ml: -1.5, minHeight: 44, px: 1.5, borderRadius: 999, textTransform: "none", fontSize: "1rem", fontWeight: 600, color: "text.secondary", ...tappable }}
                >
                  {t("stakesPreviewTitle")}
                </Button>
              )}
            </Box>
          </Box>
        )}

        {canDraw && (
          <Box sx={{ mt: hasTeams ? 0.5 : 0 }}>
            <Button
              startIcon={<ShuffleIcon />} variant={hasTeams ? "text" : "outlined"} disabled={!gate.ok || teams.isDrawing} aria-busy={teams.isDrawing || undefined}
              aria-describedby={gate.ok ? undefined : "draw-reason"} onClick={startDraw}
              sx={{
                minHeight: 48, borderRadius: 999, textTransform: "none", fontWeight: 700, ...(hasTeams ? { color: "text.secondary", ml: -1 } : { color: "text.primary", borderColor: controlBorder }),
                ...motion("opacity", 120), ...tappable,
              }}
            >
              {hasTeams ? t("ngDrawAgain") : t("ngDrawNow")}
            </Button>
            {!gate.ok && <Typography id="draw-reason" data-testid="draw-reason" sx={{ fontSize: "0.9375rem", lineHeight: 1.4, color: "text.secondary", textWrap: "pretty" }}>{t("tbNeedTwo")}</Typography>}
          </Box>
        )}

        <DrawDialog
          step={step} count={count} canBalance={event.eloEnabled || event.balanced} balancedDefault={event.balanced}
          onClose={() => setStep(null)} onConfirm={(balanced) => void runDraw(balanced)}
        />
        <StakesSheet
          open={stakesOpen} onClose={() => setStakesOpen(false)} stakes={stakes} teamNames={outcomeTeams} viewerName={stakes.data?.viewerName ?? null}
          crewOf={(name) => crews?.[name]} stakeOf={(name) => stakes.stakeMap?.[name]}
        />
      </PageSection>
      )}
    </>
  );
}
