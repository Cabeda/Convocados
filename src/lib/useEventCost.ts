import { useState, useEffect, useCallback } from "react";
import { apiRequest } from "~/lib/api/client";

/** The event cost fields the client UI reads from `GET /api/events/[id]/cost`. */
export interface EventCostData {
  totalAmount: number;
  currency: string;
  paymentMethods: string | null;
  effectivePaymentMethods: string | null;
}

/**
 * Fetch the event's cost (price, payment methods). Shared by the event-page
 * payment surface and the payments-page cost section.
 */
export function useEventCost(eventId: string) {
  const [cost, setCost] = useState<EventCostData | null>(null);

  const load = useCallback(async () => {
    try {
      const data = (await apiRequest("GET /api/events/{id}/cost", { params: { id: eventId } })) as EventCostData;
      setCost(data);
    } catch { /* ignore */ }
  }, [eventId]);

  useEffect(() => { load(); }, [load]);

  return { cost, load };
}
