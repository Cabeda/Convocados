/* eslint-disable -- THROWAWAY prototype: no polish, no tests. Delete or move to a prototype branch. */
import { useCallback, useEffect, useState } from "react";
import { useSession } from "~/lib/auth.client";

/**
 * Data layer for the post-game prototype. Reads the REAL API (same origin,
 * session cookie included) and folds it into one view-model shared by all
 * variants. Anything the real data cannot supply is filled with values flagged
 * in `mocks` so the UI can label them "(mock)". Writes are NEVER sent.
 */

export interface PrototypeTeam { name: string; players: string[] }
export interface PrototypePayRow { name: string; amount: number; paid: boolean; isPayer: boolean }
export interface PrototypeMatchEvent {
  type: string; team: string; minute: number | null; count: number;
  ownGoal: boolean; penalty: boolean; scorerName: string; assistName: string | null;
}

export interface PrototypeModel {
  eventId: string;
  loading: boolean;
  error: string | null;
  signedIn: boolean;
  title: string;
  timezone: string;
  lastGame: { dateTime: string; scoreOne: number | null; scoreTwo: number | null; teamOneName: string; teamTwoName: string };
  teams: PrototypeTeam[];
  bench: string[];
  declined: string[];
  mvp: { winners: string[]; votingOpen: boolean; candidates: { id: string; name: string }[]; hasVoted: boolean | null };
  currency: string;
  payerName: string;
  payments: PrototypePayRow[];
  rankDelta: number;
  matchEvents: PrototypeMatchEvent[];
  next: { dateTime: string; spotsLeft: number; maxPlayers: number };
  viewer: { name: string; teamIndex: number; isMock: boolean; owes: number; canVote: boolean };
  /** Which pieces are mock, for "(mock)" labels. */
  mocks: Set<string>;
}

async function getJson<T = any>(url: string): Promise<{ ok: boolean; status: number; data: T | null }> {
  try {
    const res = await fetch(url, { credentials: "include" });
    const data = res.headers.get("content-type")?.includes("json") ? ((await res.json()) as T) : null;
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

const ci = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function formatPrototypeDate(iso: string, timezone: string, withTime = false): string {
  const d = new Date(iso);
  const tz = timezone || undefined;
  const parts = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: tz }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const base = `${get("weekday")} ${get("day")} ${get("month")}`;
  if (!withTime) return base;
  const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: tz }).format(d);
  return `${base} ${time}`;
}

export function formatPrototypeMoney(amount: number, currency: string): string {
  const sym = currency.toUpperCase() === "EUR" ? "€" : currency.toUpperCase() === "GBP" ? "£" : currency.toUpperCase() === "USD" ? "$" : `${currency} `;
  return `${sym}${Number.isInteger(amount) ? amount : amount.toFixed(2)}`;
}

const EMPTY: PrototypeModel = {
  eventId: "", loading: true, error: null, signedIn: false, title: "", timezone: "UTC",
  lastGame: { dateTime: new Date().toISOString(), scoreOne: null, scoreTwo: null, teamOneName: "Team 1", teamTwoName: "Team 2" },
  teams: [], bench: [], declined: [],
  mvp: { winners: [], votingOpen: false, candidates: [], hasVoted: null },
  currency: "EUR", payerName: "", payments: [], rankDelta: 0, matchEvents: [],
  next: { dateTime: new Date().toISOString(), spotsLeft: 0, maxPlayers: 0 },
  viewer: { name: "", teamIndex: 0, isMock: true, owes: 0, canVote: true },
  mocks: new Set(),
};

export function usePrototypePostGameData(eventId: string): PrototypeModel {
  const { data: session, isPending } = useSession();
  const viewerNameRaw: string | null = session?.user?.name ?? null;
  const signedIn = !!session?.user;
  const [model, setModel] = useState<PrototypeModel>({ ...EMPTY, eventId });

  const load = useCallback(async () => {
    const mocks = new Set<string>();
    const ev = await getJson(`/api/events/${eventId}`);
    if (!ev.ok || !ev.data) {
      setModel({ ...EMPTY, eventId, loading: false, error: ev.status === 404 ? `Event "${eventId}" not found (has the seed run?)` : `Could not load event (HTTP ${ev.status})` });
      return;
    }
    const event = ev.data;
    if (event.locked) {
      setModel({ ...EMPTY, eventId, loading: false, error: "Event is password-locked." });
      return;
    }
    const [statusRes, histRes] = await Promise.all([
      getJson(`/api/events/${eventId}/post-game-status`),
      getJson(`/api/events/${eventId}/history?limit=1`),
    ]);
    const status = statusRes.data ?? event.postGameStatus ?? null;
    const latest = histRes.data?.data?.[0] ?? null;
    const historyId: string | null = status?.latestHistoryId ?? latest?.id ?? null;
    const mvpRes = historyId ? await getJson(`/api/events/${eventId}/history/${historyId}/mvp`) : { ok: false, status: 0, data: null as any };
    const mvpData = mvpRes.ok ? mvpRes.data : null;

    const timezone: string = event.timezone || "UTC";
    const now = Date.now();
    const eventInFuture = new Date(event.dateTime).getTime() > now;
    // Event already rolled over to the next occurrence → the ended game lives in history.
    const rolledOver = eventInFuture && !!latest;

    // ── Teams ──
    let teams: PrototypeTeam[] = [];
    let bench: string[] = [];
    const activePlayers: string[] = (event.players ?? []).map((p: any) => p.name);
    if (rolledOver && latest?.teamsSnapshot) {
      try {
        const snap = JSON.parse(latest.teamsSnapshot) as Array<{ team: string; players: Array<{ name: string }> }>;
        teams = snap.map((t) => ({ name: t.team, players: t.players.map((p) => p.name) }));
      } catch { /* ignore */ }
    }
    if (teams.length === 0) {
      teams = (event.teamResults ?? []).map((t: any) => ({ name: t.name, players: (t.members ?? []).map((m: any) => m.name) }));
    }
    if (teams.length < 2) {
      mocks.add("teams");
      const names = activePlayers.length ? activePlayers : ["Ana", "Bruno", "Carla", "Diogo", "Eva", "Filipe"];
      const half = Math.ceil(names.length / 2);
      teams = [
        { name: event.teamOneName ?? "Team 1", players: names.slice(0, half) },
        { name: event.teamTwoName ?? "Team 2", players: names.slice(half) },
      ];
    }
    const inTeams = new Set(teams.flatMap((t) => t.players.map((n) => n.toLowerCase())));
    bench = rolledOver ? [] : activePlayers.filter((n) => !inTeams.has(n.toLowerCase()));
    const declined: string[] = (event.declined ?? []).map((d: any) => d.name);

    // ── Score ──
    const scoreOne: number | null = status?.scoreOne ?? latest?.scoreOne ?? null;
    const scoreTwo: number | null = status?.scoreTwo ?? latest?.scoreTwo ?? null;
    if (scoreOne === null || scoreTwo === null) mocks.add("score");
    const lastGame = {
      dateTime: rolledOver ? latest.dateTime : (latest?.dateTime ?? event.dateTime),
      scoreOne: scoreOne ?? 3,
      scoreTwo: scoreTwo ?? 2,
      teamOneName: latest?.teamOneName ?? status?.teamOneName ?? teams[0].name,
      teamTwoName: latest?.teamTwoName ?? status?.teamTwoName ?? teams[1].name,
    };

    // ── Viewer ──
    let viewerName = viewerNameRaw;
    let teamIndex = viewerName ? teams.findIndex((t) => t.players.some((n) => ci(n, viewerName!))) : -1;
    const viewerIsMock = teamIndex < 0;
    if (viewerIsMock) {
      mocks.add("viewer");
      teamIndex = 0;
      viewerName = teams[0].players[0] ?? "You";
    }

    // ── Payments ──
    const currency: string = status?.costCurrency ?? "EUR";
    let payments: PrototypePayRow[] = [];
    let payerName: string = status?.gameConfig?.payerName ?? "";
    if (Array.isArray(status?.gamePayments) && status.gamePayments.length) {
      payments = status.gamePayments.map((r: any) => ({ name: r.name, amount: r.amount, paid: r.status === "paid", isPayer: !!r.isPayer }));
    } else if (Array.isArray(status?.paymentsSnapshot) && status.paymentsSnapshot.length) {
      payments = status.paymentsSnapshot.map((r: any) => ({ name: r.playerName, amount: r.amount, paid: r.status === "paid", isPayer: false }));
    }
    if (payments.length === 0) {
      mocks.add("payments");
      const all = teams.flatMap((t) => t.players);
      payments = all.map((n, i) => ({ name: n, amount: 5, paid: i % 3 !== 1, isPayer: i === 0 }));
    }
    if (!payerName) {
      payerName = payments.find((p) => p.isPayer)?.name ?? "";
      if (!payerName) { mocks.add("payer"); payerName = payments[0]?.name ?? "the organiser"; }
    }
    let owes = 0;
    if (viewerIsMock) {
      owes = 5; // mock: show the pay button so the layout is judgeable
    } else {
      const mine = payments.find((p) => ci(p.name, viewerName!));
      owes = mine && !mine.isPayer && !mine.paid ? mine.amount : 0;
    }

    // ── MVP ──
    let mvp = { winners: [] as string[], votingOpen: true, candidates: [] as { id: string; name: string }[], hasVoted: null as boolean | null };
    if (mvpData) {
      mvp = {
        winners: (mvpData.mvp ?? []).map((m: any) => m.playerName),
        votingOpen: !!mvpData.isVotingOpen,
        candidates: (mvpData.participants ?? []).filter((p: any) => !ci(p.name, viewerName!)).map((p: any) => ({ id: p.id, name: p.name })),
        hasVoted: mvpData.hasVoted ?? null,
      };
    }
    if (mvp.candidates.length === 0) {
      mocks.add("mvp");
      mvp.candidates = teams.flatMap((t) => t.players).filter((n) => !ci(n, viewerName!)).map((n) => ({ id: `name:${n}`, name: n }));
    }
    const canVote = viewerIsMock ? true : mvp.votingOpen && mvp.hasVoted === false;
    if (viewerIsMock) mvp.hasVoted = false;

    // ── Rank ──
    let rankDelta = 12;
    if (status?.seasonRank?.counted) rankDelta = status.seasonRank.delta;
    else mocks.add("rank");

    // ── Next game ──
    const maxPlayers: number = event.maxPlayers ?? 10;
    let next = { dateTime: event.dateTime as string, spotsLeft: Math.max(0, maxPlayers - activePlayers.length), maxPlayers };
    if (!eventInFuture) {
      mocks.add("next");
      next = { dateTime: new Date(new Date(event.dateTime).getTime() + 7 * 86400_000).toISOString(), spotsLeft: 3, maxPlayers };
    }

    setModel({
      eventId, loading: false, error: null, signedIn, title: event.title, timezone,
      lastGame, teams, bench, declined, mvp, currency, payerName, payments, rankDelta,
      matchEvents: (latest?.matchEvents ?? []) as PrototypeMatchEvent[],
      next,
      viewer: { name: viewerName!, teamIndex, isMock: viewerIsMock, owes, canVote },
      mocks,
    });
  }, [eventId, viewerNameRaw, signedIn]);

  useEffect(() => {
    if (isPending) return;
    load();
  }, [load, isPending]);

  return model;
}

/** Local-state-only stand-ins for the write actions. They NEVER call the API. */
export function usePrototypeStubs(model: PrototypeModel) {
  const [votedFor, setVotedFor] = useState<string | null>(null);
  const [paid, setPaid] = useState(false);
  const [rsvp, setRsvp] = useState<"yes" | "no" | null>(null);
  const needsVote = model.viewer.canVote && !votedFor;
  const owesAmount = paid ? 0 : model.viewer.owes;
  return { votedFor, setVotedFor, paid, setPaid, rsvp, setRsvp, needsVote, owesAmount };
}
