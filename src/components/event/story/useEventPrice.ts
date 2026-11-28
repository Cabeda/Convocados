import { useEffect, useState } from "react";
import { apiRequest } from "~/lib/api/client";
import type { EventCostData } from "~/lib/useEventCost";

/**
 * The event's price, fetched once for someone who may see it. `loaded` tells "no price set"
 * apart from "not asked yet", so the header never flashes a "Set a price" link that is wrong.
 */
export function useEventPrice(eventId: string, enabled: boolean): { loaded: boolean; cost: EventCostData | null } {
  const [state, setState] = useState<{ loaded: boolean; cost: EventCostData | null }>({ loaded: false, cost: null });
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    apiRequest("GET /api/events/{id}/cost", { params: { id: eventId } })
      .then((d) => alive && setState({ loaded: true, cost: (d as EventCostData | null) ?? null }))
      .catch(() => alive && setState({ loaded: true, cost: null }));
    return () => { alive = false; };
  }, [eventId, enabled]);
  return state;
}
