import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "~/lib/api/client";

export type MyRsvp = "yes" | "no" | "maybe" | null;

/** The signed-in viewer's own answer for this game (GET /rsvp). Signed-out viewers have none. */
export function useMyRsvp(eventId: string, signedIn: boolean) {
  const [rsvp, setRsvp] = useState<MyRsvp>(null);

  useEffect(() => {
    if (!signedIn || !eventId) return;
    let alive = true;
    apiRequest("GET /api/events/{id}/rsvp", { params: { id: eventId }, init: { credentials: "include" } })
      .then((data) => { if (alive) setRsvp(((data as { status?: unknown }).status ?? null) as MyRsvp); })
      .catch(() => { if (alive) setRsvp(null); });
    return () => { alive = false; };
  }, [eventId, signedIn]);

  // Signed out there is no answer, whatever an earlier visit left in state.
  return [signedIn ? rsvp : null, useCallback((next: MyRsvp) => setRsvp(next), [])] as const;
}
