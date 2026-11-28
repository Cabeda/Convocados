import { vi } from "vitest";

export const DAY = 86_400_000;
export const HOUR = 3_600_000;

export interface Row { id: string; name: string; userId: string | null; image?: string | null; position?: string | null }

/** An event payload as GET /api/events/{id} returns it, with the fields the page reads. */
export function makeEvent(over: Record<string, unknown> = {}) {
  return {
    id: "evt-1", title: "Monday Football", location: "Campo", dateTime: new Date(Date.now() + 5 * DAY).toISOString(), timezone: "UTC",
    maxPlayers: 10, durationMinutes: 90, teamOneName: "Ninjas", teamTwoName: "Gunas", isRecurring: false, isPublic: false, balanced: false,
    eloEnabled: false, hideEloInTeams: false, showCompetitiveData: false, splitCostsEnabled: false, positionsEnabled: false,
    mvpEnabled: false, mvpEloEnabled: false, sport: "football-5v5", recurrenceRule: null, ownerId: "owner-9", ownerName: "Sam",
    players: [] as Row[], teamResults: [], gameStatus: null, gameId: null, ...over,
  };
}

export const WEEKLY = JSON.stringify({ freq: "weekly", interval: 1, byDay: "FR" });

/** An answer with a status code: `server.on("POST", "/players", () => respond(402, { code: "PAYMENT_GATE" }))`. */
export const respond = (status: number, body: Json = {}): { __reply: true; status: number; body: Json } => ({ __reply: true, status, body });

type Json = Record<string, unknown> | unknown[];
type Reply = { __reply: true; status: number; body: Json };
type Out = Reply | Json | void;
type Handler = (call: { url: string; method: string; body: Record<string, any> | undefined; headers: Record<string, string> }) => Out | Promise<Out>;

/**
 * A tiny in-memory server behind `fetch`: GET /api/events/evt-1 answers `state.event`, other routes answer
 * what a test registers (first match wins), everything else is an empty 200. `calls` records every request.
 */
export function fakeServer(event: Record<string, any>) {
  const state = { event };
  const routes: Array<{ method: string; part: string; handler: Handler }> = [];
  const calls: Array<{ url: string; method: string; body: Record<string, any> | undefined; headers: Record<string, string> }> = [];

  const on = (method: string, part: string, handler: Handler) => { routes.unshift({ method, part, handler }); };

  const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, any>) : undefined;
    const call = { url, method, body, headers: (init?.headers ?? {}) as Record<string, string> };
    calls.push(call);
    const reply = (status: number, payload: unknown) => new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
    for (const r of routes) {
      if (r.method === method && url.includes(r.part)) {
        const out = await r.handler(call);
        if (out === undefined) return reply(200, {});
        if (typeof out === "object" && out !== null && "__reply" in out) return reply((out as Reply).status, (out as Reply).body);
        return reply(200, out);
      }
    }
    if (method === "GET" && /\/api\/events\/evt-1(\?|$)/.test(url)) return reply(200, state.event);
    if (url.includes("/known-players") || url.includes("/co-players")) return reply(200, { players: [] });
    if (url.includes("/suggestions")) return reply(200, { suggestions: [] });
    if (url.includes("/balance")) return reply(200, { callerBalance: { amount: 0 } });
    return reply(200, {});
  });

  return {
    state, on, calls, fetch: fetchMock,
    install: () => vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch),
    /** Requests of one kind, e.g. `server.sent("POST", "/players")`. */
    sent: (method: string, part: string) => calls.filter((c) => c.method === method && c.url.includes(part)),
  };
}
