import { useCallback, useRef } from "react";
import { apiRequest } from "~/lib/api/client";
import { decidePaymentGate } from "~/lib/paymentGate";

interface GateInput { amount: number; gateAmount: number; enforcement: string; threshold: number }

/** A balance read is good for a minute, so a second tap does not wait for the network again. */
const FRESH_MS = 60_000;

/**
 * Client mirror of the server's payment gate (ADR 0006): before joining, ask whether the
 * viewer's balance would stop or nudge them. The server stays authoritative (402 PAYMENT_GATE),
 * so a failed read here simply lets the join try.
 */
export function usePaymentGate(eventId: string) {
  const cache = useRef<{ at: number; input: GateInput } | null>(null);

  const read = useCallback(async (): Promise<GateInput | null> => {
    if (cache.current && Date.now() - cache.current.at < FRESH_MS) return cache.current.input;
    try {
      const j = (await apiRequest("GET /api/events/{id}/balance", { params: { id: eventId } })) as {
        callerBalance?: { amount?: number }; gateAmount?: number; enforcement?: string; threshold?: number;
      };
      const amount = j?.callerBalance?.amount ?? 0;
      const input = { amount, gateAmount: j?.gateAmount ?? amount, enforcement: j?.enforcement ?? "off", threshold: j?.threshold ?? 0 };
      cache.current = { at: Date.now(), input };
      return input;
    } catch {
      return null;
    }
  }, [eventId]);

  /** "prompt" when the shared decision is anything but "allow". */
  const decide = useCallback(async (): Promise<"allow" | "prompt"> => {
    const b = await read();
    if (!b) return "allow";
    const verdict = decidePaymentGate({
      enforcement: b.enforcement, isSelfService: true, outstandingAmount: b.amount, gateAmount: b.gateAmount, threshold: b.threshold,
    });
    return verdict === "allow" ? "allow" : "prompt";
  }, [read]);

  return { decide, forget: useCallback(() => { cache.current = null; }, []) };
}
