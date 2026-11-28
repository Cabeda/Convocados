/* eslint-disable -- THROWAWAY prototype */
/**
 * Variant B v3 — "One page, one story", after the full-sweep audit (see PrototypeCoverage.tsx).
 *
 * The page is always the NEXT game. The last game rides on top as a recap card that changes shape:
 *   1 just ended → 2 all done → 3 later (one-line strip) → 4 game day (recap gone).
 * Everything the old page did has a home: app navbar (unchanged chrome), header (event info, share, follow,
 * ⋮ sheet, admin edit), recap (score, MVP, pay), next game (RSVP, lineup, add a friend, bench, waiting list,
 * teams + owner controls). What does NOT live here is listed in the Coverage view.
 */
import { useEffect, useRef, useState } from "react";
import { Box, Button, IconButton, Stack, TextField, Typography } from "@mui/material";
import PaymentsIcon from "@mui/icons-material/Payments";
import GroupsIcon from "@mui/icons-material/Groups";
import LeaderboardIcon from "@mui/icons-material/Leaderboard";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import PlaceIcon from "@mui/icons-material/Place";
import ScheduleIcon from "@mui/icons-material/Schedule";
import EmojiEventsIcon from "@mui/icons-material/EmojiEvents";
import CheckIcon from "@mui/icons-material/Check";
import ShareIcon from "@mui/icons-material/Share";
import BookmarkBorderIcon from "@mui/icons-material/BookmarkBorder";
import BookmarkIcon from "@mui/icons-material/Bookmark";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import EditIcon from "@mui/icons-material/Edit";
import PersonAddIcon from "@mui/icons-material/PersonAdd";
import CloseIcon from "@mui/icons-material/Close";
import NotificationsIcon from "@mui/icons-material/Notifications";
import PublicIcon from "@mui/icons-material/Public";
import SettingsIcon from "@mui/icons-material/Settings";
import EventIcon from "@mui/icons-material/Event";
import HistoryIcon from "@mui/icons-material/History";
import CalendarMonthIcon from "@mui/icons-material/CalendarMonth";
import HowToRegIcon from "@mui/icons-material/HowToReg";
import ListAltIcon from "@mui/icons-material/ListAlt";
import EventBusyIcon from "@mui/icons-material/EventBusy";
import ShuffleIcon from "@mui/icons-material/Shuffle";
import { formatPrototypeDate, formatPrototypeMoney, type PrototypeModel } from "./prototypePostGameData";

export type PrototypeStage = 1 | 2 | 3 | 4;

export const STAGES: { key: PrototypeStage; label: string; desc: string }[] = [
  { key: 1, label: "1 · Just ended", desc: "You open the page after the game. Recap card on top with what's left for you. Next game below." },
  { key: 2, label: "2 · All done", desc: "To-dos finished. The card says so and the next-game RSVP becomes the main action." },
  { key: 3, label: "3 · A few days later", desc: "Recap shrinks to one line (tap to reopen). The page is simply the next game." },
  { key: 4, label: "4 · Game day", desc: "Recap is gone (kept in History). An unpaid share stays as a small reminder." },
];

export interface PrototypeScenario {
  viewer: "played" | "bench" | "absent" | "signedOut";
  outcome: "won" | "lost" | "draw";
  /** Owner or admin: edit details, cancel, draw teams, remove anyone, set price, add score without playing. */
  admin: boolean;
  score: "set" | "missing";
  mvp: "open" | "voted" | "closed" | "disabled";
  money: "owes" | "paid" | "collector" | "nopayer" | "nocost";
  /** Next game's roster */
  roster: "filling" | "oneLeft" | "full" | "bench";
  recurring: "weekly" | "oneOff";
  status: "normal" | "cancelled";
}

export const DEFAULT_SCENARIO: PrototypeScenario = {
  viewer: "played", outcome: "won", admin: false, score: "set", mvp: "open", money: "owes",
  roster: "filling", recurring: "weekly", status: "normal",
};

export const SCENARIO_FIELDS: { key: keyof PrototypeScenario; label: string; options: [string, string][] }[] = [
  { key: "viewer", label: "Who is looking", options: [["played", "Played"], ["bench", "On the bench"], ["absent", "Not in the game"], ["signedOut", "Signed out"]] },
  { key: "outcome", label: "Result for them", options: [["won", "Won"], ["lost", "Lost"], ["draw", "Draw"]] },
  { key: "admin", label: "Owner or admin", options: [["false", "No"], ["true", "Yes"]] },
  { key: "score", label: "Score", options: [["set", "Registered"], ["missing", "Not added yet"]] },
  { key: "mvp", label: "MVP", options: [["open", "Voting open"], ["voted", "I already voted"], ["closed", "Voting closed"], ["disabled", "Turned off"]] },
  { key: "money", label: "Money", options: [["owes", "I owe my share"], ["paid", "I already paid"], ["collector", "I'm collecting"], ["nopayer", "Nobody collecting"], ["nocost", "No cost set"]] },
  { key: "roster", label: "Next game roster", options: [["filling", "Filling up (8 of 16)"], ["oneLeft", "One spot left"], ["full", "Full, teams drawn"], ["bench", "Full + 2 on the bench"]] },
  { key: "recurring", label: "Event type", options: [["weekly", "Weekly"], ["oneOff", "One-off (no next game)"]] },
  { key: "status", label: "Next game status", options: [["normal", "Normal"], ["cancelled", "Cancelled"]] },
];

const BODY = '"Atkinson Hyperlegible", "Inter", system-ui, sans-serif';
const NUM = '"Barlow Condensed", "Inter", sans-serif';
const LINE = "rgba(232,238,233,0.14)";
const SURFACE = "rgba(255,255,255,0.05)";
const WHISTLE = "#F2C14E";
const DANGER = "#FF8A80";
const MINUS = "\u2212";
const MOCK_EXTRA = ["Rui Pinto", "Ana Mota", "Beto Sá"];
const FRIEND_CHIPS = ["Rui Pinto", "Ana Mota", "Beto Sá", "Luis Faria"];

const ci = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const SKIP = new Set(["ms.", "mr.", "mrs.", "dr.", "iv", "ii", "iii", "v", "md", "jr.", "sr."]);
const tokens = (n: string) => n.split(/\s+/).filter((t) => !SKIP.has(t.toLowerCase()));
const shortName = (n: string) => { const t = tokens(n); return t.length > 1 ? `${t[0]} ${t[1][0]}.` : (t[0] ?? n); };
const initials = (n: string) => tokens(n).slice(0, 2).map((t) => t[0]).join("").toUpperCase();

const pill = { minHeight: 48, borderRadius: 999, fontSize: 17, fontWeight: 700, textTransform: "none", boxShadow: "none" } as const;

function Stepper({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const btn = { minWidth: 44, width: 44, height: 44, p: 0, borderRadius: "50%", fontSize: 22, borderColor: LINE, color: "text.primary" } as const;
  return (
    <Box sx={{ textAlign: "center", flex: 1 }}>
      <Typography sx={{ fontSize: 15, color: "text.secondary" }}>{label}</Typography>
      <Typography sx={{ fontFamily: NUM, fontWeight: 700, fontSize: 80, lineHeight: 1 }}>{value}</Typography>
      <Stack direction="row" justifyContent="center" spacing={1.5}>
        <Button aria-label={`One less goal for ${label}`} variant="outlined" sx={btn} onClick={() => onChange(Math.max(0, value - 1))}>{MINUS}</Button>
        <Button aria-label={`One more goal for ${label}`} variant="outlined" sx={btn} onClick={() => onChange(value + 1)}>+</Button>
      </Stack>
    </Box>
  );
}

function Row({ title, sub, action, onAction, href, done }: {
  title: string; sub?: string; action?: string; onAction?: () => void; href?: string; done?: boolean;
}) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, minHeight: 64, px: 2, borderTop: `1px solid ${LINE}` }}>
      {done
        ? <CheckIcon sx={{ color: "primary.main", fontSize: 20 }} />
        : <Box aria-hidden sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: WHISTLE, flex: "0 0 auto", ml: 0.5, mr: 0.5 }} />}
      <Box sx={{ flex: 1, minWidth: 0, py: 1 }}>
        <Typography sx={{ fontSize: 17, fontWeight: done ? 400 : 700, color: done ? "text.secondary" : "text.primary" }}>{title}</Typography>
        {sub && <Typography sx={{ fontSize: 14, color: "text.secondary" }}>{sub}</Typography>}
      </Box>
      {action && (
        <Button variant="contained" onClick={onAction} {...(href ? { component: "a", href, target: "_blank" } : {})}
          sx={{ ...pill, minHeight: 44, px: 2.5, fontSize: 16, whiteSpace: "nowrap" }}>
          {action}
        </Button>
      )}
    </Box>
  );
}

/** The real app bar is unchanged chrome (ResponsiveLayout). Drawn here so the design is judged with it in place. */
function Navbar({ signedOut }: { signedOut: boolean }) {
  return (
    <Box sx={{ position: "sticky", top: 0, zIndex: 5, bgcolor: "background.default", borderBottom: `1px solid ${LINE}`, height: 56, display: "flex", alignItems: "center", px: 1.5, gap: 0.5 }}>
      <Box sx={{ width: 28, height: 28, borderRadius: "50%", bgcolor: "primary.main", mr: 1 }} aria-hidden />
      <Typography sx={{ fontSize: 18, fontWeight: 700 }}>Convocados</Typography>
      <Typography sx={{ fontSize: 11, border: `1px solid ${LINE}`, borderRadius: 1, px: 0.5, ml: 0.75, color: "text.secondary" }}>beta</Typography>
      <Box sx={{ flex: 1 }} />
      {!signedOut && (
        <IconButton aria-label="Notifications, 3 unread" sx={{ color: "text.primary", position: "relative" }}>
          <NotificationsIcon />
          <Box sx={{ position: "absolute", top: 4, right: 2, bgcolor: DANGER, color: "#2b0a0a", fontSize: 11, fontWeight: 700, borderRadius: 999, px: 0.6, lineHeight: "16px" }}>3</Box>
        </IconButton>
      )}
      <IconButton aria-label="Public games" sx={{ color: "text.primary" }}><PublicIcon /></IconButton>
      {signedOut ? (
        <>
          <IconButton aria-label="Language and theme" sx={{ color: "text.primary" }}><SettingsIcon /></IconButton>
          <Button variant="contained" sx={{ ...pill, minHeight: 40, px: 2, fontSize: 15 }}>Sign in</Button>
        </>
      ) : (
        <Box aria-label="Account menu" role="button" tabIndex={0} sx={{ width: 36, height: 36, borderRadius: "50%", bgcolor: "primary.main", color: "primary.contrastText", display: "grid", placeItems: "center", fontWeight: 700, ml: 0.5 }}>N</Box>
      )}
    </Box>
  );
}

const MENU: { group: string; admin?: boolean; items: { label: string; icon: React.ReactNode; danger?: boolean; adminOnly?: boolean; signedIn?: boolean }[] }[] = [
  { group: "This game", items: [
    { label: "Add to calendar", icon: <EventIcon fontSize="small" /> },
    { label: "Cancel game", icon: <EventBusyIcon fontSize="small" />, danger: true, adminOnly: true },
  ] },
  { group: "Look back", items: [
    { label: "History and results", icon: <HistoryIcon fontSize="small" /> },
    { label: "Seasons and ranking", icon: <CalendarMonthIcon fontSize="small" /> },
    { label: "Attendance", icon: <HowToRegIcon fontSize="small" /> },
    { label: "Activity log", icon: <ListAltIcon fontSize="small" /> },
    { label: "Payments", icon: <PaymentsIcon fontSize="small" /> },
  ] },
  { group: "You", items: [{ label: "My notifications for this game", icon: <NotificationsIcon fontSize="small" />, signedIn: true }] },
  { group: "Manage", items: [{ label: "Settings", icon: <SettingsIcon fontSize="small" />, adminOnly: true }] },
];

export function PrototypeVariantB({ model, scenario = DEFAULT_SCENARIO, stage = 1, onStageChange }: {
  model: PrototypeModel; scenario?: PrototypeScenario; stage?: PrototypeStage; onStageChange?: (s: PrototypeStage) => void;
}) {
  const sc = scenario;
  const [voting, setVoting] = useState(false);
  const [pick, setPick] = useState<string | null>(null);
  const [votedFor, setVotedFor] = useState<string | null>(null);
  const [paid, setPaid] = useState(false);
  const [rsvp, setRsvp] = useState<"in" | "out" | null>(sc.roster === "full" && sc.viewer !== "signedOut" ? "in" : null);
  const [draft, setDraft] = useState<[number, number]>([0, 0]);
  const [savedScore, setSavedScore] = useState<[number, number] | null>(null);
  const [toggled, setToggled] = useState<boolean | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [following, setFollowing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addText, setAddText] = useState("");
  const [addError, setAddError] = useState("");
  const [added, setAdded] = useState<string[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; undo: () => void } | null>(null);
  const [drawnEarly, setDrawnEarly] = useState(false);
  const [waitingOpen, setWaitingOpen] = useState(false);
  const [pushDismissed, setPushDismissed] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const acted = useRef(false);
  const { lastGame: g } = model;

  useEffect(() => { setToggled(null); }, [stage]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    const id = "proto-postgame-fonts";
    if (document.getElementById(id)) return;
    const l = document.createElement("link");
    l.id = id; l.rel = "stylesheet";
    l.href = "https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&family=Barlow+Condensed:wght@600;700&display=swap";
    document.head.appendChild(l);
  }, []);

  const played = sc.viewer === "played";
  const signedOut = sc.viewer === "signedOut";
  const engaged = played || signedOut;
  const admin = sc.admin && !signedOut;
  const weekly = sc.recurring === "weekly";
  const cancelled = sc.status === "cancelled";
  const canAddScore = played || admin;
  const teamNames = [g.teamOneName, g.teamTwoName];

  // ── score ──
  const hi = Math.max(g.scoreOne ?? 0, g.scoreTwo ?? 0), lo = Math.min(g.scoreOne ?? 0, g.scoreTwo ?? 0);
  const scenarioScores: [number, number] = sc.outcome === "draw" ? [lo, lo] : [hi, lo];
  const scoreMissing = sc.score === "missing" && !savedScore;
  const scores = savedScore ?? scenarioScores;
  const winnerIdx = scores[0] === scores[1] ? -1 : scores[0] > scores[1] ? 0 : 1;
  const viewerTeam = played ? (sc.outcome === "lost" ? 1 : 0) : -1;
  const delta = winnerIdx === -1 ? 0 : viewerTeam === winnerIdx ? model.rankDelta : -Math.max(1, Math.round(Math.abs(model.rankDelta) / 3));
  const deltaText = delta === 0 ? "no change" : `${delta > 0 ? "+" : MINUS}${Math.abs(delta)}`;
  const outcomeWords =
    scoreMissing ? "Score not added yet"
    : winnerIdx === -1 ? "It was a draw"
    : played ? (viewerTeam === winnerIdx ? "You won" : "You lost")
    : `${teamNames[winnerIdx]} won`;
  const summary = `${outcomeWords}${played && !scoreMissing ? ` · ${deltaText} points this season` : ""}`;

  // ── MVP ──
  const mvpState = sc.mvp === "open" && votedFor ? "voted" : sc.mvp;
  const votedName = model.mvp.candidates.find((c) => c.id === votedFor)?.name ?? model.mvp.candidates[0]?.name ?? "a teammate";

  // ── money ──
  const hasCost = sc.money !== "nocost";
  const paidCount = model.payments.filter((p) => p.paid).length;
  const totalCount = model.payments.length;
  const collected = model.payments.filter((p) => p.paid).reduce((a, p) => a + p.amount, 0);
  const total = model.payments.reduce((a, p) => a + p.amount, 0);
  const myShare = model.viewer.owes || 5;
  const money = (n: number) => formatPrototypeMoney(n, model.currency);
  const url = (p: string) => `/events/${model.eventId}/${p}`;
  const stillOwes = played && sc.money === "owes" && !paid;

  // ── what's left for the viewer ──
  type Task = { key: string; title: string; sub?: string; action?: string; onAction?: () => void; href?: string };
  const pending: Task[] = [];
  const done: string[] = [];
  if (played) {
    if (mvpState === "open") pending.push({ key: "mvp", title: "Vote for MVP", sub: "Who was the best player?", action: "Vote", onAction: () => setVoting((v) => !v) });
    else if (mvpState === "voted") done.push(`Voted for ${shortName(votedName)}`);

    if (sc.money === "owes" && !paid) pending.push({ key: "pay", title: `Pay ${money(myShare)}`, sub: `${model.payerName} is collecting`, action: "Pay", onAction: () => { acted.current = true; setPaid(true); } });
    else if (sc.money === "owes" || sc.money === "paid") done.push(`Paid ${money(myShare)}`);
    else if (sc.money === "collector") pending.push({ key: "collect", title: "You're collecting", sub: `${money(collected)} of ${money(total)} · ${paidCount} of ${totalCount} paid`, action: "See who owes", href: url("payments") });
    else if (sc.money === "nopayer") pending.push({ key: "nopayer", title: `You owe ${money(myShare)}`, sub: admin ? "Nobody is collecting yet" : "Nobody is collecting yet. The organiser will pick someone.", action: admin ? "Choose who" : undefined });
  }
  const addScoreNeeded = canAddScore && scoreMissing;
  const hasPending = pending.length > 0 || addScoreNeeded;

  useEffect(() => {
    if (stage === 1 && acted.current && !hasPending && onStageChange) onStageChange(2);
  }, [stage, hasPending, onStageChange]);

  // ── how much recap to show ──
  const hidden = stage === 4 && weekly;
  const defaultExpanded = stage >= 3 ? hasPending && engaged : engaged;
  const expanded = !hidden && (addScoreNeeded || (toggled ?? defaultExpanded));
  const canCollapse = !hasPending;
  const showTasks = expanded && engaged;

  // ── next game + roster ──
  const max = model.next.maxPlayers || 16;
  const nextDate = formatPrototypeDate(model.next.dateTime, model.timezone, true);
  const nextTime = nextDate.slice(-5);
  const nextDay = nextDate.slice(0, -6);
  const viewerName = model.viewer.name || "You";
  const allNames = Array.from(new Set(model.teams.flatMap((t) => t.players)));
  const others = allNames.filter((n) => !ci(n, viewerName));
  const pool = [...others, ...MOCK_EXTRA.filter((n) => !others.some((o) => ci(o, n)))];
  const baseCount = sc.roster === "filling" ? 8 : sc.roster === "bench" ? 18 : 15;
  const everyone = [...pool.slice(0, baseCount).filter((n) => !removed.includes(n)), ...added, ...(rsvp === "in" ? [viewerName] : [])];
  const lineup = everyone.slice(0, max);
  const bench = everyone.slice(max);
  const teamsDrawn = lineup.length >= max;
  const teamsShown = teamsDrawn || drawnEarly;
  const team1 = lineup.filter((_, i) => i % 2 === 0);
  const team2 = lineup.filter((_, i) => i % 2 === 1);
  const myTeam = rsvp === "in" && lineup.includes(viewerName) ? (team1.includes(viewerName) ? 1 : 2) : 0;
  const myBenchPos = rsvp === "in" ? bench.indexOf(viewerName) + 1 : 0;
  const emphasise = !hasPending || !engaged;
  const gameDay = stage === 4 && weekly;
  const playedCount = model.teams.reduce((a, t) => a + t.players.length, 0);
  const canSeeWaiting = played || admin;
  const canRemove = (n: string) => !ci(n, viewerName) && (admin || added.includes(n));

  const addFriend = (raw: string) => {
    const name = raw.trim();
    if (!name) return;
    if (everyone.some((n) => ci(n, name))) { setAddError(`${name} is already in the list.`); return; }
    const full = lineup.length >= max;
    setAdded((a) => [...a, name]);
    setAddText(""); setAddError(""); setAddOpen(false);
    setToast({ text: `${shortName(name)} ${full ? "added to the bench" : "added"}`, undo: () => setAdded((a) => a.filter((x) => x !== name)) });
  };
  const removeSlot = (n: string) => {
    const wasAdded = added.includes(n);
    if (wasAdded) setAdded((a) => a.filter((x) => x !== n)); else setRemoved((r) => [...r, n]);
    setSelected(null);
    setToast({ text: `${shortName(n)} removed`, undo: () => { if (wasAdded) setAdded((a) => [...a, n]); else setRemoved((r) => r.filter((x) => x !== n)); } });
  };

  if (model.loading) return <Box sx={{ p: 3, fontSize: 16 }}>Loading…</Box>;
  if (model.error) return <Box sx={{ p: 3, fontSize: 16 }}>{model.error}</Box>;

  // ───────── pieces ─────────
  const header = (
    <Box>
      <Stack direction="row" alignItems="center" sx={{ mr: -1 }}>
        <Typography component="h1" sx={{ flex: 1, fontSize: 28, fontWeight: 700, lineHeight: 1.15 }}>{model.title.split(" (")[0]}</Typography>
        {admin && <IconButton aria-label="Edit game details" onClick={() => setEditing((e) => !e)} sx={{ color: "text.secondary" }}><EditIcon fontSize="small" /></IconButton>}
        <IconButton aria-label="Share this game" sx={{ color: "text.primary" }}><ShareIcon /></IconButton>
        {!signedOut && (
          <IconButton aria-label={following ? "Following this game. Tap to stop." : "Follow this game for reminders"} aria-pressed={following} onClick={() => setFollowing((f) => !f)} sx={{ color: following ? "primary.main" : "text.primary" }}>
            {following ? <BookmarkIcon /> : <BookmarkBorderIcon />}
          </IconButton>
        )}
        <IconButton aria-label="More" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)} sx={{ color: "text.primary" }}><MoreVertIcon /></IconButton>
      </Stack>

      {editing ? (
        <Stack spacing={1.25} sx={{ mt: 1 }}>
          {[["Name", "Ninjas"], ["When", `Fri ${nextTime} (every week)`], ["Where", "Park Lane pitch"]].map(([l, v]) => (
            <TextField key={l} size="small" label={l} defaultValue={v} fullWidth />
          ))}
          <Typography sx={{ fontSize: 14, color: "text.secondary" }}>Sport, time zone and price are in Settings.</Typography>
          <Stack direction="row" spacing={1}>
            <Button variant="contained" sx={{ ...pill, flex: 1 }} onClick={() => setEditing(false)}>Save</Button>
            <Button sx={{ ...pill, flex: 1, color: "text.secondary" }} onClick={() => setEditing(false)}>Cancel</Button>
          </Stack>
        </Stack>
      ) : (
        <Box sx={{ mt: 0.75 }}>
          <Stack direction="row" spacing={0.75} alignItems="center" sx={{ color: "text.secondary" }}>
            <ScheduleIcon sx={{ fontSize: 18 }} /><Typography sx={{ fontSize: 15 }}>{weekly ? `Every Friday at ${nextTime} · 90 min` : `${nextDay} at ${nextTime} · 90 min`}</Typography>
          </Stack>
          <Stack direction="row" spacing={0.75} alignItems="center" sx={{ color: "text.secondary" }}>
            <PlaceIcon sx={{ fontSize: 18 }} />
            <Typography sx={{ fontSize: 15 }}>
              <Box component="a" href="https://www.google.com/maps/search/?api=1&query=Park+Lane+pitch" target="_blank" rel="noreferrer" sx={{ color: "primary.main", fontWeight: 700 }}>Park Lane pitch</Box>
              {hasCost ? ` · ${formatPrototypeMoney(5, model.currency)} each` : admin ? " · " : ""}
              {!hasCost && admin && <Box component="a" href={url("payments")} target="_blank" sx={{ color: "primary.main", fontWeight: 700 }}>Set a price</Box>}
            </Typography>
          </Stack>
        </Box>
      )}

      {menuOpen && (
        <Box role="menu" sx={{ mt: 1.5, bgcolor: SURFACE, borderRadius: 3, overflow: "hidden" }}>
          {MENU.map((grp) => {
            const items = grp.items.filter((i) => (!i.adminOnly || admin) && (!i.signedIn || !signedOut));
            if (!items.length) return null;
            return (
              <Box key={grp.group}>
                <Typography sx={{ px: 2, pt: 1.5, pb: 0.5, fontSize: 14, color: "text.secondary" }}>{grp.group}</Typography>
                {items.map((i) => (
                  <Box key={i.label} role="menuitem" tabIndex={0} sx={{ display: "flex", alignItems: "center", gap: 1.5, minHeight: 48, px: 2, cursor: "pointer", color: i.danger ? DANGER : "text.primary", "&:hover": { bgcolor: "rgba(255,255,255,0.06)" } }}>
                    {i.icon}<Typography sx={{ fontSize: 16 }}>{i.label}</Typography>
                  </Box>
                ))}
              </Box>
            );
          })}
          <Typography sx={{ px: 2, py: 1.5, fontSize: 13, color: "text.secondary", borderTop: `1px solid ${LINE}` }}>(A bottom sheet in the real app)</Typography>
        </Box>
      )}
    </Box>
  );

  const numeral = (i: 0 | 1, size: number) => (
    <Typography sx={{ fontFamily: NUM, fontWeight: 700, fontSize: size, lineHeight: 0.95, fontVariantNumeric: "tabular-nums", color: scoreMissing ? "text.disabled" : winnerIdx === -1 || winnerIdx === i ? "primary.main" : "text.secondary" }}>
      {scoreMissing ? "–" : scores[i]}
    </Typography>
  );

  const stripView = (
    <Box component="button" aria-expanded={false} onClick={() => setToggled(true)}
      sx={{ all: "unset", boxSizing: "border-box", width: "100%", cursor: "pointer", bgcolor: SURFACE, borderRadius: 3, p: 2, display: "flex", alignItems: "center", gap: 1.5, "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main" } }}>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: 14, color: "text.secondary" }}>Last game · {formatPrototypeDate(g.dateTime, model.timezone)}</Typography>
        {scoreMissing ? (
          <Typography sx={{ fontSize: 17, fontWeight: 700 }}>Score not added yet</Typography>
        ) : (
          <Typography sx={{ fontSize: 17, fontWeight: 700 }}>
            {teamNames[0]} <Box component="span" sx={{ fontFamily: NUM, fontSize: 24, color: winnerIdx === 0 ? "primary.main" : "text.secondary" }}>{scores[0]}</Box>
            {" – "}
            <Box component="span" sx={{ fontFamily: NUM, fontSize: 24, color: winnerIdx === 1 ? "primary.main" : "text.secondary" }}>{scores[1]}</Box> {teamNames[1]}
          </Typography>
        )}
        {played && !scoreMissing && <Typography sx={{ fontSize: 14, color: "text.secondary" }}>{outcomeWords}</Typography>}
      </Box>
      <Stack alignItems="center" sx={{ color: "primary.main", fontSize: 13, fontWeight: 700 }}><ExpandMoreIcon /><Box sx={{ mt: -0.5 }}>Details</Box></Stack>
    </Box>
  );

  const recapCard = (
    <Box sx={{ bgcolor: SURFACE, borderRadius: 3, overflow: "hidden" }}>
      <Box sx={{ px: 2, pt: 2, pb: 2.5 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.5 }}>
          <Typography sx={{ fontSize: 15, color: "text.secondary" }}>Last game · {formatPrototypeDate(g.dateTime, model.timezone)}</Typography>
          {canCollapse && weekly && (
            <Button size="small" onClick={() => setToggled(false)} endIcon={<ExpandLessIcon />} sx={{ minHeight: 44, mr: -1, textTransform: "none", fontWeight: 700, fontSize: 15 }}>Hide</Button>
          )}
        </Stack>

        {addScoreNeeded ? (
          <Stack direction="row" spacing={1}>
            <Stepper label={teamNames[0]} value={draft[0]} onChange={(v) => setDraft([v, draft[1]])} />
            <Stepper label={teamNames[1]} value={draft[1]} onChange={(v) => setDraft([draft[0], v])} />
          </Stack>
        ) : (
          <Box sx={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 1 }}>
            {[0, 1].map((i) => (
              <Box key={i} sx={{ display: "contents" }}>
                {i === 1 && <Typography aria-hidden sx={{ fontFamily: NUM, fontSize: 48, lineHeight: 0.95, color: "text.disabled", pb: 0.5 }}>–</Typography>}
                <Box sx={{ flex: 1, textAlign: i === 0 ? "left" : "right" }}>
                  <Typography sx={{ fontSize: 16, fontWeight: !scoreMissing && winnerIdx === i ? 700 : 400 }}>{teamNames[i]}</Typography>
                  {numeral(i as 0 | 1, 84)}
                </Box>
              </Box>
            ))}
          </Box>
        )}

        {!addScoreNeeded && <Typography sx={{ fontSize: 17, fontWeight: 700, mt: 1.5 }}>{summary}</Typography>}
        {addScoreNeeded && <Typography sx={{ fontSize: 15, color: "text.secondary", textAlign: "center", mt: 1.5 }}>Nobody has added the score yet. Add it so everyone sees it.</Typography>}
        {!addScoreNeeded && scoreMissing && !canAddScore && <Typography sx={{ fontSize: 15, color: "text.secondary" }}>Someone who played will add it soon.</Typography>}
        {mvpState === "closed" && (
          <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mt: 0.5 }}>
            <EmojiEventsIcon sx={{ fontSize: 18, color: WHISTLE }} />
            <Typography sx={{ fontSize: 15 }}>MVP: {model.mvp.winners.length ? model.mvp.winners.join(" & ") : "no votes this time"}</Typography>
          </Stack>
        )}
      </Box>

      {addScoreNeeded && <Row title="Save the score" action="Save" onAction={() => { acted.current = true; setSavedScore(draft); }} />}

      {showTasks && !signedOut && pending.map((t) => (
        <Box key={t.key}>
          <Row title={t.title} sub={t.sub} action={t.action} onAction={t.onAction} href={t.href} />
          {t.key === "mvp" && voting && (
            <Box sx={{ px: 2, pb: 2 }} role="radiogroup" aria-label="MVP candidates">
              {model.mvp.candidates.slice(0, 5).map((c) => {
                const on = pick === c.id;
                return (
                  <Box key={c.id} role="radio" aria-checked={on} tabIndex={0} onClick={() => setPick(c.id)}
                    onKeyDown={(e) => (e.key === " " || e.key === "Enter") && setPick(c.id)}
                    sx={{ minHeight: 52, display: "flex", alignItems: "center", gap: 1.5, cursor: "pointer", borderTop: `1px solid ${LINE}`, "&:first-of-type": { borderTop: 0 } }}>
                    <Box sx={{ width: 22, height: 22, borderRadius: "50%", border: "2px solid", borderColor: on ? "primary.main" : "text.secondary", display: "grid", placeItems: "center" }}>
                      {on && <Box sx={{ width: 11, height: 11, borderRadius: "50%", bgcolor: "primary.main" }} />}
                    </Box>
                    <Typography sx={{ fontSize: 17, fontWeight: on ? 700 : 400 }}>{c.name}</Typography>
                  </Box>
                );
              })}
              <Typography sx={{ fontSize: 14, color: "text.secondary", py: 1 }}>+ {Math.max(0, model.mvp.candidates.length - 5)} more · search by name</Typography>
              <Button variant="contained" fullWidth disabled={!pick} sx={{ ...pill, minHeight: 52 }} onClick={() => { acted.current = true; setVotedFor(pick); setVoting(false); }}>Confirm vote</Button>
            </Box>
          )}
        </Box>
      ))}

      {showTasks && !signedOut && !hasPending && done.length > 0 && <Row done title="All done" sub={done.join(" · ")} />}
      {showTasks && signedOut && (sc.mvp !== "disabled" || hasCost) && (
        <Row title={`Sign in to ${sc.mvp !== "disabled" && sc.mvp !== "closed" ? "vote and " : ""}see what you owe`} action="Sign in" href="/auth/signin" />
      )}

      {showTasks && played && (
        <Box sx={{ display: "flex", borderTop: `1px solid ${LINE}` }}>
          {[
            { label: "Lineup", sub: `${playedCount} played`, href: url("history"), icon: <GroupsIcon fontSize="small" />, show: true },
            { label: "Payments", sub: `${paidCount}/${totalCount} paid`, href: url("payments"), icon: <PaymentsIcon fontSize="small" />, show: hasCost && sc.money !== "nopayer" },
            { label: "Ranking", sub: "this season", href: url("rankings"), icon: <LeaderboardIcon fontSize="small" />, show: true },
          ].filter((l) => l.show).map((l, i) => (
            <Button key={l.label} component="a" href={l.href} target="_blank"
              sx={{ flex: 1, minHeight: 64, flexDirection: "column", gap: 0.25, borderRadius: 0, textTransform: "none", color: "text.primary", borderLeft: i ? `1px solid ${LINE}` : 0 }}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, fontSize: 16, fontWeight: 700 }}>{l.icon}{l.label}</Box>
              <Box sx={{ fontSize: 13, color: "text.secondary" }}>{l.sub}</Box>
            </Button>
          ))}
        </Box>
      )}
    </Box>
  );

  const reminder = hidden && stillOwes ? (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, borderLeft: `4px solid ${WHISTLE}`, bgcolor: SURFACE, borderRadius: 2, pl: 2, pr: 1.5, py: 1 }}>
      <Box sx={{ flex: 1 }}>
        <Typography sx={{ fontSize: 17, fontWeight: 700 }}>You still owe {money(myShare)}</Typography>
        <Typography sx={{ fontSize: 14, color: "text.secondary" }}>for last game · {model.payerName} is collecting</Typography>
      </Box>
      <Button variant="contained" sx={{ ...pill, minHeight: 44, px: 2.5 }} onClick={() => { acted.current = true; setPaid(true); }}>Pay</Button>
    </Box>
  ) : null;

  const pushBanner = stage === 2 && weekly && played && !pushDismissed && !following ? (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, bgcolor: SURFACE, borderRadius: 3, pl: 2, pr: 0.5, py: 0.5 }}>
      <NotificationsIcon sx={{ color: "primary.main" }} />
      <Typography sx={{ flex: 1, fontSize: 15 }}>Get a reminder before Friday's game?</Typography>
      <Button sx={{ minHeight: 44, textTransform: "none", fontWeight: 700 }} onClick={() => { setFollowing(true); setPushDismissed(true); }}>Turn on</Button>
      <IconButton aria-label="Not now" onClick={() => setPushDismissed(true)} sx={{ color: "text.secondary" }}><CloseIcon fontSize="small" /></IconButton>
    </Box>
  ) : null;

  const cancelledBanner = cancelled ? (
    <Box sx={{ borderLeft: `4px solid ${DANGER}`, bgcolor: SURFACE, borderRadius: 2, pl: 2, pr: 1.5, py: 1.25 }}>
      <Typography sx={{ fontSize: 17, fontWeight: 700 }}>This game was cancelled</Typography>
      <Typography sx={{ fontSize: 14, color: "text.secondary" }}>{admin ? "A cancelled game can't be reopened. Plan a new one from your games." : "Nobody can join or be added any more."}</Typography>
    </Box>
  ) : null;

  // ── add a friend ──
  const addPanel = addOpen ? (
    <Box sx={{ bgcolor: SURFACE, borderRadius: 3, p: 2, mt: 1.5 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Typography sx={{ fontSize: 18, fontWeight: 700 }}>Add a friend</Typography>
        <IconButton aria-label="Close" onClick={() => { setAddOpen(false); setAddError(""); }} sx={{ color: "text.secondary", mr: -1 }}><CloseIcon /></IconButton>
      </Stack>
      <TextField autoFocus fullWidth size="medium" placeholder="Their name, or their email" value={addText}
        onChange={(e) => { setAddText(e.target.value); setAddError(""); }}
        onKeyDown={(e) => e.key === "Enter" && addFriend(addText)}
        error={!!addError} helperText={addError || " "} slotProps={{ htmlInput: { "aria-label": "Friend's name or email", maxLength: 120 } }} sx={{ mt: 1 }} />
      <Typography sx={{ fontSize: 14, color: "text.secondary", mb: 0.75 }}>Played with you before</Typography>
      <Stack direction="row" flexWrap="wrap" gap={1} sx={{ mb: 1.5 }}>
        {FRIEND_CHIPS.filter((n) => !everyone.some((e) => ci(e, n))).map((n) => (
          <Button key={n} variant="outlined" onClick={() => addFriend(n)} sx={{ ...pill, minHeight: 44, fontSize: 15, px: 1.75, borderColor: LINE, color: "text.primary" }}>{shortName(n)}</Button>
        ))}
      </Stack>
      <Button variant="contained" fullWidth disabled={!addText.trim()} onClick={() => addFriend(addText)} sx={pill}>
        {lineup.length >= max ? "Add to the bench" : "Add to the game"}
      </Button>
      {lineup.length >= max && <Typography sx={{ fontSize: 14, color: "text.secondary", mt: 1 }}>The game is full, so they go on the bench and move up if someone drops out.</Typography>}
      <Stack direction="row" justifyContent="space-between" sx={{ mt: 1 }}>
        <Button onClick={() => setLinkCopied(true)} sx={{ minHeight: 44, textTransform: "none", fontWeight: 700 }}>{linkCopied ? "Link copied ✓" : "Send them an invite link"}</Button>
        <Button sx={{ minHeight: 44, textTransform: "none", fontWeight: 700, color: "text.secondary" }}>Add several</Button>
      </Stack>
    </Box>
  ) : null;

  // ── next game ──
  const slots = Array.from({ length: max }, (_, i) => lineup[i] ?? null);
  const rsvpBlock = cancelled ? null : (
    <Box sx={{ mt: 2 }}>
      {signedOut ? (
        <Button component="a" href="/auth/signin" target="_blank" variant="contained" fullWidth sx={{ ...pill, minHeight: 56, fontSize: 18 }}>Sign in to join</Button>
      ) : rsvp ? (
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ minHeight: 56 }}>
          <Typography sx={{ fontSize: 19, fontWeight: 700 }}>
            {rsvp === "in" ? (myBenchPos ? `You're on the bench (#${myBenchPos})` : myTeam ? `You're in · Team ${myTeam}` : "You're in") : "You're out"}
          </Typography>
          <Button onClick={() => setRsvp(null)} sx={{ minHeight: 44, textTransform: "none", fontSize: 16, fontWeight: 700 }}>Change</Button>
        </Stack>
      ) : (
        <Stack direction="row" spacing={1.5} alignItems="center">
          <Button variant={emphasise ? "contained" : "outlined"} onClick={() => setRsvp("in")} sx={{ ...pill, flex: 1, minHeight: 56, fontSize: 18 }}>
            {lineup.length >= max ? "Join the bench" : gameDay ? "I'm coming" : "I'm in"}
          </Button>
          <Button onClick={() => setRsvp("out")} sx={{ ...pill, flex: 1, minHeight: 56, color: "text.secondary" }}>Can't make it</Button>
        </Stack>
      )}
    </Box>
  );

  const selectedIsRemovable = selected && canRemove(selected);
  const lineupBlock = (
    <Box sx={{ mt: 2.5 }}>
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: 0.75 }} aria-label={`${lineup.length} of ${max} places taken`}>
        {slots.map((n, i) => {
          const me = n && ci(n, viewerName) && rsvp === "in";
          const clickable = !!n && canRemove(n);
          return (
            <Box key={i} component={clickable ? "button" : "div"} onClick={clickable ? () => setSelected(selected === n ? null : n) : undefined}
              aria-label={n ? (clickable ? `${n}. Tap for options` : n) : "Open spot"} title={n ?? "Open spot"}
              sx={{
                all: clickable ? "unset" : undefined, boxSizing: "border-box", aspectRatio: "1", borderRadius: "50%", display: "grid", placeItems: "center", fontSize: 12, fontWeight: 700, cursor: clickable ? "pointer" : "default",
                ...(n ? { bgcolor: me ? "primary.main" : "rgba(255,255,255,0.12)", color: me ? "primary.contrastText" : "text.primary", outline: selected === n ? "2px solid" : "none", outlineColor: "primary.main" } : { border: "1.5px dashed rgba(232,238,233,0.3)" }),
              }}>{n ? initials(n) : ""}</Box>
          );
        })}
      </Box>

      {selectedIsRemovable && (
        <Stack direction="row" alignItems="center" sx={{ mt: 1, bgcolor: SURFACE, borderRadius: 2, pl: 2, pr: 0.5, minHeight: 52 }}>
          <Typography sx={{ flex: 1, fontSize: 16, fontWeight: 700 }}>{selected}</Typography>
          <Button onClick={() => removeSlot(selected!)} sx={{ minHeight: 44, textTransform: "none", fontWeight: 700, color: DANGER }}>Remove</Button>
          <IconButton aria-label="Close" onClick={() => setSelected(null)} sx={{ color: "text.secondary" }}><CloseIcon fontSize="small" /></IconButton>
        </Stack>
      )}

      <Typography sx={{ fontSize: 15, color: "text.secondary", mt: 1.25 }}>
        {lineup.length} of {max} are in{lineup.length < max ? ` · ${max - lineup.length === 1 ? "1 spot left" : `${max - lineup.length} spots left`}. Teams are drawn automatically when it's full.` : "."}
      </Typography>

      {bench.length > 0 && (
        <Typography sx={{ fontSize: 15, mt: 1 }}>
          <b>Bench ({bench.length})</b> · {bench.map(shortName).join(", ")} <Box component="span" sx={{ color: "text.secondary" }}>move up if someone drops out.</Box>
        </Typography>
      )}

      {canSeeWaiting && (
        <Box sx={{ mt: 1 }}>
          <Button onClick={() => setWaitingOpen((o) => !o)} endIcon={waitingOpen ? <ExpandLessIcon /> : <ExpandMoreIcon />} sx={{ minHeight: 44, ml: -1, textTransform: "none", fontSize: 15, fontWeight: 700, color: "text.secondary" }}>
            2 invited · 1 can't make it
          </Button>
          {waitingOpen && (
            <Box sx={{ bgcolor: SURFACE, borderRadius: 2, px: 2, py: 0.5 }}>
              {[["Joe T.", "Invited by email"], ["Mia R.", "Invited by link"], ["Leo K.", "Can't make it"]].map(([n, s]) => (
                <Stack key={n} direction="row" alignItems="center" sx={{ minHeight: 48, borderTop: `1px solid ${LINE}`, "&:first-of-type": { borderTop: 0 } }}>
                  <Box sx={{ flex: 1 }}><Typography sx={{ fontSize: 16 }}>{n}</Typography><Typography sx={{ fontSize: 13, color: "text.secondary" }}>{s}</Typography></Box>
                  {admin && s.startsWith("Invited") && <Button sx={{ minHeight: 44, textTransform: "none", fontWeight: 700 }}>Resend</Button>}
                </Stack>
              ))}
            </Box>
          )}
        </Box>
      )}

      {!cancelled && !signedOut && (
        <Stack direction="row" spacing={1.5} sx={{ mt: 1.5 }}>
          <Button variant="outlined" startIcon={<PersonAddIcon />} onClick={() => setAddOpen((o) => !o)} sx={{ ...pill, flex: 1, borderColor: LINE, color: "text.primary" }}>Add a friend</Button>
        </Stack>
      )}
      {!cancelled && addPanel}

      {toast && (
        <Stack direction="row" alignItems="center" sx={{ mt: 1.5, bgcolor: "rgba(255,255,255,0.1)", borderRadius: 2, pl: 2, pr: 0.5, minHeight: 48 }} role="status">
          <Typography sx={{ flex: 1, fontSize: 15 }}>{toast.text}</Typography>
          <Button onClick={() => { toast.undo(); setToast(null); }} sx={{ minHeight: 44, textTransform: "none", fontWeight: 700 }}>Undo</Button>
        </Stack>
      )}
    </Box>
  );

  const teamsBlock = teamsShown || (admin && lineup.length >= 2 && !cancelled) ? (
    <Box sx={{ mt: 2.5 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Typography sx={{ fontSize: 15, color: "text.secondary" }}>{teamsShown ? `Teams for ${gameDay ? "today" : "Friday"}${teamsDrawn ? "" : " (drawn early)"}` : "Teams"}</Typography>
        {teamsShown && <Button sx={{ minHeight: 44, mr: -1, textTransform: "none", fontWeight: 700 }}>Pitch view</Button>}
      </Stack>
      {teamsShown && (
        <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: 2 }}>
          {[team1, team2].map((t, ti) => (
            <Box key={ti}>
              <Stack direction="row" alignItems="center" sx={{ borderBottom: `2px solid ${ti === 0 ? "#7EDCAB" : LINE}`, pb: 0.5, mb: 0.5 }}>
                <Typography sx={{ fontFamily: NUM, fontWeight: 700, fontSize: 22, flex: 1 }}>Team {ti + 1}</Typography>
                {admin && <IconButton aria-label={`Rename team ${ti + 1}`} size="small" sx={{ color: "text.secondary" }}><EditIcon sx={{ fontSize: 16 }} /></IconButton>}
              </Stack>
              {t.map((n) => (
                <Typography key={n} sx={{ fontSize: 16, lineHeight: 1.9, fontWeight: ci(n, viewerName) && rsvp === "in" ? 700 : 400, color: ci(n, viewerName) && rsvp === "in" ? "primary.main" : "text.primary" }}>{shortName(n)}</Typography>
              ))}
            </Box>
          ))}
        </Box>
      )}
      {admin && (
        <Stack direction="row" spacing={1.5} sx={{ mt: 1 }}>
          {!teamsShown ? (
            <Button variant="outlined" startIcon={<ShuffleIcon />} onClick={() => setDrawnEarly(true)} sx={{ ...pill, flex: 1, borderColor: LINE, color: "text.primary" }}>Draw teams now</Button>
          ) : (
            <Button startIcon={<ShuffleIcon />} sx={{ minHeight: 44, textTransform: "none", fontWeight: 700 }}>Draw again</Button>
          )}
        </Stack>
      )}
    </Box>
  ) : null;

  const nextGame = weekly ? (
    <Box>
      <Typography sx={{ fontSize: 15, color: "text.secondary" }}>{gameDay ? "Game day" : "Next game"}</Typography>
      <Typography sx={{ fontFamily: NUM, fontWeight: 700, fontSize: 40, lineHeight: 1 }}>{gameDay ? `Today · ${nextTime}` : `${nextDay} · ${nextTime}`}</Typography>
      {gameDay && !cancelled && <Typography sx={{ fontSize: 15, color: "text.secondary", mt: 0.5 }}>Starts in 3 h 12 min</Typography>}
      {rsvpBlock}
      {lineupBlock}
      {teamsBlock}
    </Box>
  ) : (
    <Box sx={{ bgcolor: SURFACE, borderRadius: 3, p: 2 }}>
      <Typography sx={{ fontSize: 20, fontWeight: 700 }}>Play again?</Typography>
      <Typography sx={{ fontSize: 15, color: "text.secondary", mb: 1.5 }}>{admin ? "Make this a weekly game, or plan one more." : "Ask Nuno to plan the next one."}</Typography>
      {admin && (
        <Stack spacing={1}>
          <Button variant="contained" sx={pill}>Make it weekly</Button>
          <Button variant="outlined" sx={{ ...pill, borderColor: LINE, color: "text.primary" }}>Plan another game</Button>
        </Stack>
      )}
    </Box>
  );

  return (
    <Box sx={{ fontFamily: BODY, color: "text.primary", "& *": { fontFamily: "inherit" }, "& .MuiTypography-root": { lineHeight: 1.4 } }}>
      <Navbar signedOut={signedOut} />
      <Stack spacing={3} sx={{ p: 2, pb: 10 }}>
        {header}
        {cancelledBanner}
        {reminder}
        {!hidden && (expanded ? recapCard : stripView)}
        {pushBanner}
        {nextGame}
      </Stack>
    </Box>
  );
}
