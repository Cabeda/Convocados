/* eslint-disable -- THROWAWAY prototype */
/** Variant C "Tabs / story": four labelled tabs, one focused screen each. */
import { useState } from "react";
import { Box, Button, LinearProgress, Paper, Stack, Typography } from "@mui/material";
import {
  formatPrototypeDate, formatPrototypeMoney, usePrototypeStubs, type PrototypeMatchEvent, type PrototypeModel,
} from "./prototypePostGameData";
import { PrototypeMockTag, PrototypeSignInNotice } from "./PrototypeShared";

const TABS = ["Result", "Teams", "Money", "Next game"] as const;
type Tab = (typeof TABS)[number];
const BIG = { minHeight: 56, fontSize: 17, fontWeight: 700, borderRadius: 3, textTransform: "none" } as const;
const ci = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function PrototypeVariantC({ model }: { model: PrototypeModel }) {
  const [tab, setTab] = useState<Tab>("Result");
  const s = usePrototypeStubs(model);
  if (model.loading) return <Box sx={{ p: 3, fontSize: 16 }}>Loading…</Box>;
  if (model.error) return <Box sx={{ p: 3, fontSize: 16 }}>{model.error}</Box>;

  return (
    <Box>
      <Box sx={{ position: "sticky", top: 0, zIndex: 5, bgcolor: "background.default", p: 1.5, borderBottom: "1px solid", borderColor: "divider" }}>
        <Box role="tablist" sx={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 0.5, p: 0.5, borderRadius: 3, bgcolor: "action.hover" }}>
          {TABS.map((t) => (
            <Box
              key={t} role="tab" aria-selected={tab === t} tabIndex={0}
              onClick={() => setTab(t)} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setTab(t)}
              sx={{
                minHeight: 48, display: "grid", placeItems: "center", textAlign: "center", cursor: "pointer", borderRadius: 2.5,
                fontSize: 15, fontWeight: tab === t ? 800 : 600, px: 0.5,
                bgcolor: tab === t ? "primary.main" : "transparent", color: tab === t ? "primary.contrastText" : "text.primary",
              }}
            >
              {t}
            </Box>
          ))}
        </Box>
      </Box>
      <Stack spacing={2} sx={{ p: 2, pb: 10, "& *": { lineHeight: 1.35 } }}>
        <PrototypeSignInNotice model={model} />
        {tab === "Result" && <ResultTab model={model} s={s} />}
        {tab === "Teams" && <TeamsTab model={model} />}
        {tab === "Money" && <MoneyTab model={model} s={s} />}
        {tab === "Next game" && <NextTab model={model} s={s} />}
      </Stack>
    </Box>
  );
}

type Stubs = ReturnType<typeof usePrototypeStubs>;

function ResultTab({ model, s }: { model: PrototypeModel; s: Stubs }) {
  const g = model.lastGame, m = model.mocks;
  const [pick, setPick] = useState<string | null>(null);
  const one = g.scoreOne ?? 0, two = g.scoreTwo ?? 0;
  const winner = one === two ? -1 : one > two ? 0 : 1;
  let events: PrototypeMatchEvent[] = model.matchEvents.filter((e) => e.type === "goal");
  const timelineMock = events.length === 0;
  if (timelineMock) {
    const names = model.teams.flatMap((t) => t.players);
    events = [
      { type: "goal", team: "one", minute: 8, count: 1, ownGoal: false, penalty: false, scorerName: names[0] ?? "Ana", assistName: names[1] ?? "Bruno" },
      { type: "goal", team: "two", minute: 21, count: 1, ownGoal: false, penalty: true, scorerName: names[names.length - 1] ?? "Eva", assistName: null },
      { type: "goal", team: "one", minute: 40, count: 1, ownGoal: false, penalty: false, scorerName: names[2] ?? "Carla", assistName: names[0] ?? "Ana" },
    ];
  }
  const votedName = model.mvp.candidates.find((c) => c.id === s.votedFor)?.name;
  return (
    <>
      <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 4, textAlign: "center" }}>
        <Typography sx={{ fontSize: 16, color: "text.secondary", fontWeight: 600 }}>
          {formatPrototypeDate(g.dateTime, model.timezone)}<PrototypeMockTag show={m.has("score")} />
        </Typography>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 2, mt: 1 }}>
          <Typography sx={{ fontSize: 64, fontWeight: 900, color: winner === 0 ? "success.main" : "text.primary" }}>{one}</Typography>
          <Typography sx={{ fontSize: 32, color: "text.secondary" }}>–</Typography>
          <Typography sx={{ fontSize: 64, fontWeight: 900, color: winner === 1 ? "success.main" : "text.primary" }}>{two}</Typography>
        </Box>
        <Box sx={{ display: "flex", justifyContent: "space-around" }}>
          {[g.teamOneName, g.teamTwoName].map((n, i) => (
            <Typography key={i} sx={{ fontSize: 16, fontWeight: winner === i ? 800 : 500, flex: 1 }}>
              {n}{winner === i ? " — won" : ""}
            </Typography>
          ))}
        </Box>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2, borderRadius: 4 }}>
        <Typography sx={{ fontSize: 18, fontWeight: 800, mb: 1 }}>Goals<PrototypeMockTag show={timelineMock} /></Typography>
        <Stack spacing={1}>
          {events.map((e, i) => (
            <Typography key={i} sx={{ fontSize: 16 }}>
              <b>{e.minute !== null ? `${e.minute}'` : "–"}</b> ⚽ {e.scorerName}{e.count > 1 ? ` ×${e.count}` : ""}{e.penalty ? " (pen)" : ""}{e.ownGoal ? " (own goal)" : ""}
              {e.assistName ? <span style={{ opacity: 0.8 }}> · assist {e.assistName}</span> : null}
              <span style={{ opacity: 0.8 }}> · {e.team === "one" ? g.teamOneName : e.team === "two" ? g.teamTwoName : ""}</span>
            </Typography>
          ))}
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2, borderRadius: 4 }}>
        <Typography sx={{ fontSize: 18, fontWeight: 800, mb: 1 }}>
          MVP<PrototypeMockTag show={m.has("mvp")} />
        </Typography>
        {model.mvp.winners.length > 0 && <Typography sx={{ fontSize: 16, mb: 1 }}>🏆 Current MVP: <b>{model.mvp.winners.join(" & ")}</b></Typography>}
        {votedName ? (
          <Typography sx={{ fontSize: 17, fontWeight: 700 }}>✓ You voted for {votedName}</Typography>
        ) : s.needsVote ? (
          <>
            <Typography sx={{ fontSize: 16, mb: 1 }}>Who was the best player?</Typography>
            <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1 }}>
              {model.mvp.candidates.map((c) => (
                <Button key={c.id} variant={pick === c.id ? "contained" : "outlined"} sx={{ ...BIG, minHeight: 52 }} onClick={() => setPick(c.id)} aria-pressed={pick === c.id}>
                  {c.name}
                </Button>
              ))}
            </Box>
            <Button variant="contained" fullWidth disabled={!pick} sx={{ ...BIG, mt: 1.5 }} onClick={() => s.setVotedFor(pick)}>Confirm vote</Button>
          </>
        ) : (
          <Typography sx={{ fontSize: 16 }}>{model.mvp.winners.length ? "Voting is closed." : "Voting is closed — no votes this time."}</Typography>
        )}
      </Paper>
    </>
  );
}

function TeamsTab({ model }: { model: PrototypeModel }) {
  const [more, setMore] = useState(false);
  const others = [...model.bench.map((n) => ({ n, why: "bench" })), ...model.declined.map((n) => ({ n, why: "can't make it" }))];
  return (
    <>
      <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1.5 }}>
        {model.teams.slice(0, 2).map((t, i) => (
          <Paper key={i} variant="outlined" sx={{ p: 1.5, borderRadius: 3 }}>
            <Typography sx={{ fontSize: 17, fontWeight: 800, mb: 1 }}>{t.name}<PrototypeMockTag show={model.mocks.has("teams")} /></Typography>
            <Stack spacing={0.75}>
              {t.players.map((p) => {
                const me = ci(p, model.viewer.name) && !model.viewer.isMock;
                return (
                  <Box key={p} sx={{ px: 1, py: 0.75, borderRadius: 2, bgcolor: me ? "primary.main" : "transparent", color: me ? "primary.contrastText" : "text.primary" }}>
                    <Typography sx={{ fontSize: 16, fontWeight: me ? 800 : 500 }}>{p}{me ? " (you)" : ""}</Typography>
                  </Box>
                );
              })}
            </Stack>
          </Paper>
        ))}
      </Box>
      {others.length > 0 && (
        <Paper variant="outlined" sx={{ borderRadius: 3, overflow: "hidden" }}>
          <Button fullWidth onClick={() => setMore((v) => !v)} aria-expanded={more} sx={{ ...BIG, justifyContent: "space-between", px: 2 }}>
            <span>Others ({others.length})</span><span>{more ? "Hide" : "Show"}</span>
          </Button>
          {more && (
            <Stack spacing={0.5} sx={{ p: 2, pt: 0 }}>
              {others.map((o) => <Typography key={o.n} sx={{ fontSize: 16 }}>{o.n} <span style={{ opacity: 0.75 }}>— {o.why}</span></Typography>)}
            </Stack>
          )}
        </Paper>
      )}
    </>
  );
}

function MoneyTab({ model, s }: { model: PrototypeModel; s: Stubs }) {
  const cur = model.currency;
  const isMe = (n: string) => ci(n, model.viewer.name);
  const rows = model.payments.map((r) => ({ ...r, paid: r.paid || r.isPayer || (s.paid && isMe(r.name)) }));
  const total = rows.reduce((a, r) => a + r.amount, 0);
  const collected = rows.filter((r) => r.paid).reduce((a, r) => a + r.amount, 0) + (s.paid && model.viewer.isMock ? model.viewer.owes : 0);
  const mock = model.mocks.has("payments");
  return (
    <>
      {s.owesAmount > 0 ? (
        <Paper variant="outlined" sx={{ p: 2, borderRadius: 4, borderWidth: 2, borderColor: "warning.main" }}>
          <Typography sx={{ fontSize: 18, fontWeight: 800 }}>
            You owe {formatPrototypeMoney(s.owesAmount, cur)}<PrototypeMockTag show={model.viewer.isMock} />
          </Typography>
          <Typography sx={{ fontSize: 16, mb: 1.5 }}>Pay to {model.payerName}<PrototypeMockTag show={model.mocks.has("payer")} /></Typography>
          <Button variant="contained" fullWidth sx={BIG} onClick={() => s.setPaid(true)}>Pay {formatPrototypeMoney(s.owesAmount, cur)}</Button>
        </Paper>
      ) : (
        <Paper variant="outlined" sx={{ p: 2, borderRadius: 4 }}>
          <Typography sx={{ fontSize: 18, fontWeight: 800 }}>You're all paid up ✓</Typography>
        </Paper>
      )}
      <Paper variant="outlined" sx={{ p: 2, borderRadius: 4 }}>
        <Typography sx={{ fontSize: 17, fontWeight: 800 }}>
          {formatPrototypeMoney(collected, cur)} of {formatPrototypeMoney(total, cur)} collected<PrototypeMockTag show={mock} />
        </Typography>
        <LinearProgress variant="determinate" value={total ? (collected / total) * 100 : 0} sx={{ height: 12, borderRadius: 6, my: 1.5 }} />
        <Stack divider={<Box sx={{ borderBottom: "1px solid", borderColor: "divider" }} />}>
          {rows.map((r) => (
            <Box key={r.name} sx={{ display: "flex", justifyContent: "space-between", py: 1.25 }}>
              <Typography sx={{ fontSize: 16, fontWeight: isMe(r.name) ? 800 : 500 }}>{r.name}{isMe(r.name) && !model.viewer.isMock ? " (you)" : ""}</Typography>
              <Typography sx={{ fontSize: 16, fontWeight: 700, color: r.paid ? "success.main" : "error.main" }}>
                {r.paid ? "Paid ✓" : "Not paid"}
              </Typography>
            </Box>
          ))}
        </Stack>
      </Paper>
    </>
  );
}

function NextTab({ model, s }: { model: PrototypeModel; s: Stubs }) {
  const n = model.next;
  const spots = Math.max(0, n.spotsLeft - (s.rsvp === "yes" ? 1 : 0));
  return (
    <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 4 }}>
      <Typography sx={{ fontSize: 16, color: "text.secondary", fontWeight: 600 }}>Next game<PrototypeMockTag show={model.mocks.has("next")} /></Typography>
      <Typography sx={{ fontSize: 26, fontWeight: 900, mt: 0.5 }}>{formatPrototypeDate(n.dateTime, model.timezone, true)}</Typography>
      <Typography sx={{ fontSize: 17, mt: 1, mb: 2 }}>{spots} of {n.maxPlayers} spots left</Typography>
      {s.rsvp === "yes" ? (
        <Typography sx={{ fontSize: 18, fontWeight: 800, mb: 1.5 }}>You're in ✓</Typography>
      ) : s.rsvp === "no" ? (
        <Typography sx={{ fontSize: 18, fontWeight: 800, mb: 1.5 }}>Got it — you're not coming</Typography>
      ) : null}
      <Stack spacing={1.5}>
        <Button variant="contained" fullWidth sx={BIG} onClick={() => s.setRsvp("yes")} disabled={s.rsvp === "yes"}>Join</Button>
        <Button variant="outlined" fullWidth sx={BIG} onClick={() => s.setRsvp("no")} disabled={s.rsvp === "no"}>Not coming</Button>
      </Stack>
    </Paper>
  );
}
