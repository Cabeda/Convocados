import { useState, useEffect, useCallback } from "react";

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
      const res = await fetch(`/api/events/${eventId}/cost`);
      if (res.ok) setCost(await res.json());
    } catch { /* ignore */ }
  }, [eventId]);

  useEffect(() => { load(); }, [load]);

  return { cost, load };
}
