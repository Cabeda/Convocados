import { useEffect, useMemo, useRef, useState } from "react";
import type { StakesPreviewData, StakesScenario } from "~/lib/stakesPreview";

export interface UseStakesResult {
  /** Null when there is no active Season, the viewer is not a participant, or the request failed. */
  data: StakesPreviewData | null;
  scenarioIndex: number;
  setScenarioIndex: (index: number) => void;
  /** The selected scenario (falls back to the first). */
  scenario: StakesScenario | null;
}

/**
 * Fetch the Stakes Preview for the drawn lineups. Debounced so a burst of drags
 * resolves to one request; a failed or non-participant response yields null and
 * the caller renders no stakes surfaces.
 */
export function useStakes(eventId: string, teamOne: string[], teamTwo: string[]): UseStakesResult {
  const [data, setData] = useState<StakesPreviewData | null>(null);
  const [scenarioIndex, setScenarioIndex] = useState(0);
  const lineupKey = useMemo(() => JSON.stringify([teamOne, teamTwo]), [teamOne, teamTwo]);
  const hasLineups = teamOne.length > 0 && teamTwo.length > 0;
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!hasLineups) return;
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
          setData(null);
          return;
        }
        const json = (await res.json()) as { active: boolean; preview?: StakesPreviewData };
        setData(json.active && json.preview ? json.preview : null);
      } catch {
        /* aborted or offline — keep the last projection in place */
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- lineupKey stands in for the arrays
  }, [eventId, lineupKey, hasLineups]);

  const scenario = data?.scenarios[scenarioIndex] ?? data?.scenarios[0] ?? null;
  return { data, scenarioIndex, setScenarioIndex, scenario };
}
