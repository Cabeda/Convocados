/* eslint-disable react-hooks/set-state-in-effect -- Sync-from-server pattern: the server's teams initialise local state, a move or a rename changes it at once, the next read puts the server's answer back. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiRequest, apiErrorMessage } from "~/lib/api/client";
import type { Imatch } from "~/lib/random";
import { showRatings } from "~/lib/teamsView";
import { crewMapFromLineup, liveContribution, liveCrewRoundScore } from "~/lib/stakesPreview";
import { useStakes } from "~/lib/useStakes";
import type { CrewHeaderChip, PlayerStake } from "../../team/types";
import type { EventData } from "../types";

const fromEvent = (event: EventData): Imatch[] | null => event.teamResults.length > 0
  ? event.teamResults.map((tr) => ({
    team: tr.name, formation: tr.formation ?? null,
    players: tr.members.map((m) => ({ name: m.name, order: m.order, slot: m.slot ?? null })),
  }))
  : null;

interface Input {
  event: EventData;
  refetch: () => Promise<void>;
  notify: (message: string) => void;
  /** Words for the errors; the hook has no copy of its own. */
  failed: { teams: string; names: string; draw: string };
}

/**
 * Everything the Teams block knows: the teams as the viewer sees them (a move shows at once, the server's answer
 * replaces it on the next read), the renamed team names, who is rated, and what the stakes would be.
 * Moved here from `EventPage` so the page only renders.
 */
export function useTeamsState({ event, refetch, notify, failed }: Input) {
  // Read while rendering, so the first frame already has the teams (nothing pops in and moves the page).
  const [matches, setMatches] = useState<Imatch[] | null>(() => fromEvent(event));
  const [names, setNames] = useState({ one: event.teamOneName, two: event.teamTwoName });
  const [isDrawing, setIsDrawing] = useState(false);
  const [shuffleVersion, setShuffleVersion] = useState(0);
  // A write is in flight: a poll that lands meanwhile must not put the old teams back.
  const writing = useRef(false);

  useEffect(() => {
    if (writing.current) return;
    setMatches(fromEvent(event));
    setNames({ one: event.teamOneName, two: event.teamTwoName });
  }, [event]);

  // The server's teams carry the raw names; show the (possibly just renamed) ones in both views.
  const shown = useMemo(() => matches?.map((m) => ({
    ...m, team: m.team === event.teamOneName ? names.one : m.team === event.teamTwoName ? names.two : m.team,
  })) ?? null, [matches, event.teamOneName, event.teamTwoName, names]);

  // Ratings, for a balanced game that shows them.
  const wantsRatings = showRatings(event) && !!shown;
  const [ratings, setRatings] = useState<Record<string, number> | undefined>();
  useEffect(() => {
    if (!wantsRatings) { setRatings(undefined); return; }
    const controller = new AbortController();
    apiRequest("GET /api/events/{id}/ratings", { params: { id: event.id }, query: { limit: 100 }, init: { signal: controller.signal } })
      .then((res) => {
        const map: Record<string, number> = {};
        for (const r of (res as { data: { name: string; rating: number }[] }).data ?? []) map[r.name] = r.rating;
        setRatings(map);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [wantsRatings, event.id]);

  const save = useCallback(async (next: Imatch[]) => {
    setMatches(next);
    writing.current = true;
    try {
      await apiRequest("PUT /api/events/{id}/teams", { params: { id: event.id }, body: { matches: next } });
    } catch (e) {
      notify(apiErrorMessage(e, failed.teams));
    } finally {
      writing.current = false;
    }
    void refetch();
  }, [event.id, notify, refetch, failed.teams]);

  const draw = useCallback(async (balanced: boolean) => {
    setIsDrawing(true);
    setShuffleVersion((v) => v + 1);
    try {
      await apiRequest("POST /api/events/{id}/randomize", { params: { id: event.id }, query: { balanced: balanced || undefined } });
      await refetch();
    } catch (e) {
      notify(apiErrorMessage(e, failed.draw));
    } finally {
      setIsDrawing(false);
    }
  }, [event.id, notify, refetch, failed.draw]);

  /** Show the new name at once; if the server refuses, the old one comes back and the page says so. */
  const rename = useCallback(async (index: number, name: string) => {
    const previous = names;
    const next = index === 0 ? { ...names, one: name } : { ...names, two: name };
    setNames(next);
    writing.current = true;
    try {
      await apiRequest("PUT /api/events/{id}/team-names", { params: { id: event.id }, body: { teamOneName: next.one, teamTwoName: next.two } });
      return true;
    } catch (e) {
      setNames(previous);
      notify(apiErrorMessage(e, failed.names));
      return false;
    } finally {
      writing.current = false;
      void refetch();
    }
  }, [event.id, names, notify, refetch, failed.names]);

  // Stakes: only when the teams are drawn and the viewer plays in a season; the same request as before.
  const teamOne = useMemo(() => shown?.[0]?.players.map((p) => p.name) ?? [], [shown]);
  const teamTwo = useMemo(() => shown?.[1]?.players.map((p) => p.name) ?? [], [shown]);
  const lineups = teamOne.length > 0 && teamTwo.length > 0 ? { teamOne, teamTwo } : null;
  const stakes = useStakes(event.id, lineups?.teamOne ?? [], lineups?.teamTwo ?? []);
  const crewMap = useMemo(() => crewMapFromLineup(stakes.data?.lineup ?? []), [stakes.data]);
  const scenario = stakes.scenario;
  const livePoints = useMemo(() => (lineups && scenario ? liveContribution(lineups.teamOne, lineups.teamTwo, scenario.outcome) : null), [lineups, scenario]);
  const liveCrewScore = useMemo(() => {
    if (!lineups || !livePoints) return {};
    const roster = [
      ...lineups.teamOne.map((name) => ({ name, side: "teamOne" as const })),
      ...lineups.teamTwo.map((name) => ({ name, side: "teamTwo" as const })),
    ];
    return liveCrewRoundScore(roster, crewMap, livePoints);
  }, [lineups, livePoints, crewMap]);
  const stakeMap = useMemo(() => {
    if (!scenario) return undefined;
    const map: Record<string, PlayerStake> = {};
    for (const p of scenario.players) map[p.name] = { contribution: livePoints?.[p.name] ?? p.contribution, rpDelta: p.rpDelta, passed: p.passed, provisional: p.provisional };
    return map;
  }, [scenario, livePoints]);
  const crewChips = useMemo<CrewHeaderChip[][] | undefined>(() => {
    if (!scenario) return undefined;
    return (["teamOne", "teamTwo"] as const).map((side) => {
      const ids = [...new Set(scenario.players.filter((p) => p.side === side && p.crewId).map((p) => p.crewId as string))];
      return ids.flatMap((crewId) => {
        const c = scenario.crews.find((x) => x.crewId === crewId);
        return c ? [{ crewId, name: c.name, roundScore: liveCrewScore[crewId] ?? c.roundScore, positionAfter: c.positionAfter, passed: c.passed }] : [];
      });
    });
  }, [scenario, liveCrewScore]);

  return {
    matches: shown, names, ratings, isDrawing, shuffleVersion, save, draw, rename,
    stakes: { ...stakes, crewMap, stakeMap, crewChips, liveCrewScore, hasLineups: !!lineups },
  };
}
