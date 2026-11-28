/* eslint-disable -- THROWAWAY prototype */
import { useCallback, useMemo, useState } from "react";
import { Box, Typography } from "@mui/material";
import { ThemeModeProvider } from "../ThemeModeProvider";
import { PrototypeSwitcher, type PrototypeVariantMeta } from "./PrototypeSwitcher";
import { PrototypePhoneFrame } from "./PrototypeShared";
import { PrototypeVariantA } from "./PrototypeVariantA";
import { PrototypeVariantB, DEFAULT_SCENARIO, SCENARIO_FIELDS, STAGES, type PrototypeScenario, type PrototypeStage } from "./PrototypeVariantB";
import { PrototypeVariantC } from "./PrototypeVariantC";
import { usePrototypePostGameData } from "./prototypePostGameData";
import { PrototypeCoverage } from "./PrototypeCoverage";

const VARIANTS: PrototypeVariantMeta[] = [
  { key: "compare", name: "All three side by side" },
  { key: "A", name: "Current" },
  { key: "B", name: "One page, one story" },
  { key: "story", name: "Story board: day by day" },
  { key: "coverage", name: "Coverage: where everything goes" },
  { key: "C", name: "Tabs" },
  { key: "states", name: "B in every state" },
];
const NOTES: Record<string, string> = {
  A: "The real page today (iframe of /events/<id>, same session).",
  B: "One page: recap card on top of the next game.",
  C: "Four tabs: Result · Teams · Money · Next game. One focused screen each.",
};
const FRAME_H = 900;

/** Curated "awkward" states for B. Each overrides the baseline (played · won · score in · MVP open · I owe). */
const STATES: { label: string; note: string; sc: Partial<PrototypeScenario> }[] = [
  { label: "1 · Played, won (baseline)", note: "Vote + pay still to do.", sc: {} },
  { label: "2 · Played, lost", note: "Same layout, calm tone, negative points.", sc: { outcome: "lost" } },
  { label: "3 · Played, all done", note: "Voted and paid → 'You're all set'.", sc: { mvp: "voted", money: "paid" } },
  { label: "4 · Didn't play (on the bench)", note: "One-line result, then just the next game. No to-do, no doors.", sc: { viewer: "bench", money: "owes" } },
  { label: "5 · Didn't play (not in the game)", note: "Same as 4.", sc: { viewer: "absent" } },
  { label: "6 · Signed-out visitor", note: "Result is public; one clear 'Sign in' prompt.", sc: { viewer: "signedOut" } },
  { label: "7 · Score not added (player)", note: "Anyone who played can add it, inline. Vote/pay still available.", sc: { score: "missing" } },
  { label: "8 · Score not added (admin, didn't play)", note: "Owner/admins can add it too. Everyone else sees a one-line strip.", sc: { score: "missing", admin: true, viewer: "bench" } },
  { label: "9 · MVP turned off", note: "No MVP line, no vote step.", sc: { mvp: "disabled" } },
  { label: "10 · MVP voting closed", note: "Winner shown, nothing to vote.", sc: { mvp: "closed" } },
  { label: "11 · No cost set", note: "No pay step, no 'Who paid' door.", sc: { money: "nocost" } },
  { label: "12 · Nobody collecting yet (admin view)", note: "Players are told what to expect; admins also get 'Choose who collects'.", sc: { money: "nopayer", admin: true } },
  { label: "13 · I'm the collector", note: "Progress €45 of €80 + 'See who still owes'.", sc: { money: "collector" } },
  { label: "14 · Next game: one spot left", note: "Tap 'I'm in' → the 16th slot fills and the teams appear.", sc: { roster: "oneLeft", mvp: "voted", money: "paid" } },
  { label: "15 · Next game: teams drawn", note: "Roster full → two team lists, you're highlighted.", sc: { roster: "full", mvp: "voted", money: "paid" } },
  { label: "16 · Admin view", note: "Pencil to edit details, ⋮ gets Cancel + Settings, tap a slot to remove, Draw teams now.", sc: { admin: true, roster: "filling", mvp: "voted", money: "paid" } },
  { label: "17 · Full + bench", note: "Bench row, 'Join the bench', numbered position.", sc: { roster: "bench", mvp: "voted", money: "paid" } },
  { label: "18 · Next game cancelled", note: "Banner replaces RSVP and Add a friend.", sc: { status: "cancelled", mvp: "voted", money: "paid" } },
  { label: "19 · One-off event", note: "No next game: the recap stays and 'Play again?' appears.", sc: { recurring: "oneOff", admin: true, mvp: "voted", money: "paid" } },
  { label: "20 · Bare minimum", note: "No score, no MVP, no cost: just 'Score not added yet', teams, ranking, next game.", sc: { score: "missing", mvp: "disabled", money: "nocost" } },
];


const DONE: Partial<PrototypeScenario> = { mvp: "voted", money: "paid" };
const STORY_ROWS: { title: string; sub: string; sc: Partial<PrototypeScenario>; stages: { stage: PrototypeStage; sc?: Partial<PrototypeScenario>; note: string }[] }[] = [
  {
    title: "You played",
    sub: "Same page all week. The recap card on top grows, shrinks and disappears; the next game is always underneath.",
    sc: {},
    stages: [
      { stage: 1, note: "Result first, then only what you still owe. The roster is just starting to fill." },
      { stage: 2, sc: DONE, note: "'All done', and the RSVP now stands out." },
      { stage: 3, sc: { ...DONE, roster: "oneLeft" }, note: "One line. One spot left: tap 'I'm in' and the teams appear." },
      { stage: 4, sc: { mvp: "closed", money: "owes", roster: "full" }, note: "Recap gone. Roster full, teams drawn. An unpaid share stays as a reminder." },
    ],
  },
  {
    title: "You didn't play",
    sub: "No to-dos, no recap card: one line of result, then the next game is the whole story.",
    sc: { viewer: "bench" },
    stages: [
      { stage: 1, note: "One-line result; RSVP is already the main action." },
      { stage: 2, note: "Same (nothing to finish, so the story is skipped)." },
      { stage: 3, sc: { roster: "oneLeft" }, note: "Same, roster nearly full." },
      { stage: 4, sc: { roster: "full" }, note: "Game day: the recap is gone, only the game and the teams." },
    ],
  },
];

function readVariant(): string {
  const raw = new URLSearchParams(window.location.search).get("variant") ?? "compare";
  const hit = VARIANTS.find((v) => v.key.toLowerCase() === raw.toLowerCase());
  return hit?.key ?? "compare";
}

function readScenario(): PrototypeScenario {
  const q = new URLSearchParams(window.location.search);
  const out: any = { ...DEFAULT_SCENARIO };
  for (const f of SCENARIO_FIELDS) {
    const v = q.get(f.key);
    if (v == null) continue;
    if (f.key === "admin") out.admin = v === "true";
    else if (f.options.some(([o]) => o === v)) out[f.key] = v;
  }
  return out;
}

function readStage(): PrototypeStage {
  const n = Number(new URLSearchParams(window.location.search).get("stage") ?? 1);
  return (n >= 1 && n <= 4 ? n : 1) as PrototypeStage;
}

function ScenarioPanel({ sc, onChange, stage, onStage }: { sc: PrototypeScenario; onChange: (next: PrototypeScenario) => void; stage: PrototypeStage; onStage: (s: PrototypeStage) => void }) {
  return (
    <Box sx={{ width: 290, flex: "0 0 auto", alignSelf: "flex-start", mt: 4.5, p: 2, borderRadius: 3, bgcolor: "#fff", color: "#1f2933", boxShadow: 3 }}>
      <Typography sx={{ fontWeight: 800, fontSize: 15, mb: 1 }}>Where are we in the story?</Typography>
      <Box sx={{ mb: 2 }}>
        {STAGES.map((st) => (
          <Box
            key={st.key} role="button" tabIndex={0} onClick={() => onStage(st.key)}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onStage(st.key)}
            sx={{ p: 1, mb: 0.5, borderRadius: 2, cursor: "pointer", border: "2px solid", borderColor: stage === st.key ? "#2f9e6f" : "transparent", bgcolor: stage === st.key ? "#e6f6ee" : "#f5f7fa" }}
          >
            <Typography sx={{ fontSize: 14, fontWeight: 800 }}>{st.label}</Typography>
            <Typography sx={{ fontSize: 12, color: "#52606d" }}>{st.desc}</Typography>
          </Box>
        ))}
        <Typography sx={{ fontSize: 12, color: "#52606d", mt: 0.5 }}>Finish your to-dos in stage 1 and it moves to stage 2 on its own.</Typography>
      </Box>
      <Typography sx={{ fontWeight: 800, fontSize: 15, mb: 1.5 }}>Who is looking, and what's the state</Typography>
      {SCENARIO_FIELDS.map((f) => (
        <Box key={f.key} sx={{ mb: 1.5 }}>
          <Typography component="label" htmlFor={`sc-${f.key}`} sx={{ display: "block", fontSize: 12, fontWeight: 700, color: "#52606d", mb: 0.5 }}>{f.label}</Typography>
          <select
            id={`sc-${f.key}`}
            value={String(sc[f.key])}
            onChange={(e) => onChange({ ...sc, [f.key]: f.key === "admin" ? e.target.value === "true" : e.target.value } as PrototypeScenario)}
            style={{ width: "100%", fontSize: 15, padding: "6px 8px", borderRadius: 8, border: "1px solid #bcccdc", background: "#fff", color: "#1f2933" }}
          >
            {f.options.map(([val, label]) => <option key={val} value={val}>{label}</option>)}
          </select>
        </Box>
      ))}
      <Typography sx={{ fontSize: 12, color: "#52606d" }}>The state is kept in the URL, so you can share a link to it.</Typography>
    </Box>
  );
}

function Inner({ eventId }: { eventId: string }) {
  const [variant, setVariant] = useState<string>(readVariant);
  const [scenario, setScenario] = useState<PrototypeScenario>(readScenario);
  const [stage, setStageState] = useState<PrototypeStage>(readStage);
  const model = usePrototypePostGameData(eventId);

  const change = useCallback((key: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set("variant", key);
    window.history.replaceState(null, "", url);
    setVariant(key);
  }, []);

  const setStage = useCallback((n: PrototypeStage) => {
    const url = new URL(window.location.href);
    url.searchParams.set("stage", String(n));
    window.history.replaceState(null, "", url);
    setStageState(n);
  }, []);

  const changeScenario = useCallback((next: PrototypeScenario) => {
    const url = new URL(window.location.href);
    for (const f of SCENARIO_FIELDS) url.searchParams.set(f.key, String(next[f.key]));
    window.history.replaceState(null, "", url);
    setScenario(next);
  }, []);

  const frame = (key: "A" | "B" | "C") => (
    <PrototypePhoneFrame key={key} label={`${key} — ${VARIANTS.find((v) => v.key === key)!.name}`} note={NOTES[key]} height={FRAME_H} noScroll={key === "A"}>
      {key === "A" ? <PrototypeVariantA eventId={eventId} /> : key === "B" ? <PrototypeVariantB model={model} /> : <PrototypeVariantC model={model} />}
    </PrototypePhoneFrame>
  );

  const scKey = useMemo(() => JSON.stringify(scenario), [scenario]);

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "#d9dde3", color: "#1f2933", py: 3, px: 2, pb: 12 }}>
      <Typography sx={{ textAlign: "center", fontSize: 14, mb: 2, color: "#3e4c59" }}>
        PROTOTYPE · post-game event page · {model.title || eventId} · ←/→ switches variant
      </Typography>

      {variant === "compare" && (
        <Box sx={{ display: "flex", gap: 4, overflowX: "auto", pb: 2, justifyContent: { md: "safe center" } }}>
          {frame("A")}{frame("B")}{frame("C")}
        </Box>
      )}

      {(variant === "A" || variant === "C") && <Box sx={{ display: "flex", justifyContent: "center" }}>{frame(variant)}</Box>}

      {variant === "B" && (
        <Box sx={{ display: "flex", justifyContent: "center", gap: 4, flexWrap: "wrap" }}>
          <PrototypePhoneFrame
            key={scKey}
            label="B — One page, one story"
            note="Pick a stage and a viewer on the right; tap around, nothing is saved."
            height={FRAME_H}
          >
            <PrototypeVariantB model={model} scenario={scenario} stage={stage} onStageChange={setStage} />
          </PrototypePhoneFrame>
          <ScenarioPanel sc={scenario} onChange={changeScenario} stage={stage} onStage={setStage} />
        </Box>
      )}


      {variant === "story" && (
        <Box>
          {STORY_ROWS.map((row) => (
            <Box key={row.title} sx={{ mb: 5 }}>
              <Typography sx={{ textAlign: "center", fontSize: 20, fontWeight: 800, mb: 0.5 }}>{row.title}</Typography>
              <Typography sx={{ textAlign: "center", fontSize: 14, color: "#3e4c59", mb: 2 }}>{row.sub}</Typography>
              <Box sx={{ display: "flex", gap: 4, overflowX: "auto", pb: 2, justifyContent: { xl: "safe center" } }}>
                {row.stages.map((st) => (
                  <PrototypePhoneFrame key={st.stage} label={STAGES[st.stage - 1].label} note={st.note} height={820}>
                    <PrototypeVariantB model={model} scenario={{ ...DEFAULT_SCENARIO, ...row.sc, ...st.sc }} stage={st.stage} />
                  </PrototypePhoneFrame>
                ))}
              </Box>
            </Box>
          ))}
        </Box>
      )}

      {variant === "coverage" && <PrototypeCoverage />}

      {variant === "states" && (
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 4, justifyContent: "center" }}>
          {STATES.map((s) => (
            <PrototypePhoneFrame key={s.label} label={s.label} note={s.note} height={780}>
              <PrototypeVariantB model={model} scenario={{ ...DEFAULT_SCENARIO, ...s.sc }} />
            </PrototypePhoneFrame>
          ))}
        </Box>
      )}

      <PrototypeSwitcher variants={VARIANTS} current={variant} onChange={change} />
    </Box>
  );
}

export default function PrototypePostGameApp({ eventId }: { eventId: string }) {
  return (
    <ThemeModeProvider>
      <Inner eventId={eventId} />
    </ThemeModeProvider>
  );
}
