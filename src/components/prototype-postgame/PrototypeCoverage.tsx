/* eslint-disable -- THROWAWAY prototype */
/**
 * Coverage matrix: every element/action found on the real event page (web + Android + Wear audit, 2026-11-27)
 * and WHERE it lives in the redesign — or the explicit decision that it lives elsewhere / is dropped / is a bug.
 * Sources: EventPage.tsx, event/*.tsx, ResponsiveLayout.tsx, PostGameBanner.tsx, EventDetailScreen.kt, feature-parity.yaml.
 */
import { useState } from "react";
import { Box, Typography } from "@mui/material";

type Where = "chrome" | "header" | "recap" | "next" | "sheet" | "page" | "keep" | "drop" | "bug";

const WHERE: Record<Where, { label: string; color: string; bg: string }> = {
  chrome: { label: "App chrome, unchanged", color: "#3e4c59", bg: "#e4e7eb" },
  header: { label: "Page header", color: "#0b6b4f", bg: "#d3f1e4" },
  recap: { label: "Recap card", color: "#8a5a00", bg: "#fdebc2" },
  next: { label: "Next game block", color: "#0a5a8a", bg: "#d4eafa" },
  sheet: { label: "⋮ More sheet", color: "#5b3a8a", bg: "#e6dcf5" },
  page: { label: "Another page (explicit)", color: "#7a3b00", bg: "#fbe0cc" },
  keep: { label: "Unchanged component", color: "#3e4c59", bg: "#e4e7eb" },
  drop: { label: "Dropped / replaced", color: "#6b1f1f", bg: "#f6d5d5" },
  bug: { label: "Gap or bug found", color: "#9b1c1c", bg: "#ffd9d9" },
};

type Row = [section: string, item: string, where: Where, note: string];

const ROWS: Row[] = [
  // ───── chrome
  ["App chrome", "Logo + “Convocados beta” (only way back to My games)", "chrome", "Drawn in the prototype. Sticky top bar, 56px."],
  ["App chrome", "Notifications bell with unread badge", "chrome", "Signed-in only."],
  ["App chrome", "Public games globe", "chrome", "Everyone."],
  ["App chrome", "Avatar menu: profile, My games, Admin, language, dark mode, sign out", "chrome", "Signed-in."],
  ["App chrome", "Signed-out: gear (language/theme) + Sign in", "chrome", "Sign in returns to this event."],
  ["App chrome", "Install / Update banner (bottom, one at a time)", "chrome", "Must not cover the lineup's Add a friend button; stays bottom-docked."],
  ["App chrome", "Footer: docs, GitHub, Get the app, support, version", "chrome", "Below the page; unchanged."],
  ["App chrome", "Android: no top bar/bottom nav on the event screen; hero holds Back, Follow, bell, ⋮", "keep", "Android keeps its hero. Same blocks, same order, native shell."],
  // ───── header
  ["Event header", "Title + “managed by”", "header", "Title large; managed-by link moves into the ⋮ sheet › Settings area or the title's subtitle (decide)."],
  ["Event header", "Inline edit: title, date/time, timezone, place, sport (admin, key “e”)", "header", "Pencil → inline form (name, when, where). Sport/timezone/price go to Settings."],
  ["Event header", "Time line, recurrence text, timezone label", "header", "“Every Friday at 20:49 · 90 min”. The next real date is in the Next game block."],
  ["Event header", "Location link to maps", "header", "Kept as the green link."],
  ["Event header", "Price and per-player share; “Set price” (admin) when none", "header", "“€5 each”, or “Set a price” for admins. Non-admins see nothing."],
  ["Event header", "Share button (hidden after the game today)", "header", "Always visible: it's about the NEXT game."],
  ["Event header", "Follow game (bookmark) / My notifications", "header", "Bookmark icon toggles follow; mute switches in ⋮ › My notifications."],
  ["Event header", "More actions menu", "sheet", "Groups: This game, Look back, You, Manage. Prototype shows it inline; real = bottom sheet."],
  ["Event header", "Archived badge", "header", "Small “Archived” chip next to the title (not yet drawn)."],
  ["Event header", "Claim ownership (ownerless events)", "header", "Chip “Claim this game” for signed-in users (not yet drawn)."],
  ["Event header", "Cancelled state", "header", "Red banner above the recap; RSVP and Add a friend hidden. Scenario “Cancelled”."],
  ["Event header", "Live pulse, <2h and <24h countdown", "next", "“Game day · Today 20:49 · Starts in 3 h 12 min”. Live pill replaces the countdown while playing."],
  ["Event header", "Recurring-reset alert (“list was cleared”)", "drop", "Replaced by the recap strip: the story IS the reset."],
  ["Event header", "Payer card: claim / take over / stand down", "page", "Payments page. The recap row says “Josie is collecting”."],
  ["Event header", "Debtor block “You owe €5 · Report sent”", "recap", "The Pay row. Its sheet carries “I've sent it”."],
  // ───── recap
  ["Last game", "Scoreboard", "recap", "Condensed numerals; strip when nothing left."],
  ["Last game", "Add score (web: only on /history; Android: inline)", "recap", "Inline steppers for anyone who played + owner/admins. Deep link ?action=add-score opens it. Tennis sets need a per-sport editor."],
  ["Last game", "MVP vote, result, owner/admin who didn't play", "recap", "Vote row for players. Result line for everyone."],
  ["Last game", "Rank reveal: tier, RP, crew, “why”", "recap", "One line: “+143 points this season”. Tier/crew/explainer → Ranking page."],
  ["Last game", "Payment chips, manager settle/revert, payments config", "page", "Payments page. Recap shows “Payments 9/16”."],
  ["Last game", "“Make it weekly” prompt", "next", "Replaced by “Play again?” block on one-off events (scenario)."],
  ["Last game", "Match events / goal log (Android card, C tab)", "page", "Lineup link → game detail. Parity decision needed."],
  ["Last game", "History preview, last 2 games (Android)", "page", "History page. Decide whether Android keeps it."],
  ["Last game", "Stakes preview / crew standings", "next", "Only inside Teams, as a collapsed link, and only for groups with crews."],
  // ───── next game
  ["Next game", "Join / Leave hero, “Join as {name}”", "next", "RSVP row. Leave = Change › Can't make it (keeps the 48h “no replacement” warning)."],
  ["Next game", "Signed-out: sign in to join", "next", "Primary button. Deep link ?action=join still works."],
  ["Next game", "Payment gate before joining (PaymentNudge, 402 PAYMENT_GATE)", "keep", "Unchanged dialog on “I'm in”."],
  ["Next game", "Player count, fill bar, “filling fast” momentum", "next", "16-slot lineup + “8 of 16 are in”."],
  ["Next game", "Add someone else (friend, +1, guest)", "next", "“Add a friend” panel: name/email, “played with you before” chips, Add / Add to the bench, invite link, Add several."],
  ["Next game", "Autocomplete: known players, co-players, owner suggestions", "next", "The chips + typing filter in the Add panel."],
  ["Next game", "Paste many names, contact picker, email invite", "next", "Under “Add several” and the email path of the same field."],
  ["Next game", "Add / Invite / Share-link choice dialog", "next", "Folded into the panel. A plain add is one tap."],
  ["Next game", "Position (GK/DEF/MID/FWD) when enabled", "page", "Manage lineup page; only shown in the Add panel when the event enables positions."],
  ["Next game", "Remove player + confirm + 60s undo", "next", "Tap a slot › Remove, then an Undo row. Bug: undo returns 403 for non-owners."],
  ["Next game", "Reorder (drag), reset order (owner)", "page", "“Manage lineup” page. Not on the main page."],
  ["Next game", "Bench, numbered", "next", "Bench row under the lineup; “You're on the bench (#3)”."],
  ["Next game", "Invited / pending invites with resend (24h) and retract", "next", "“2 invited · 1 can't make it” collapsed row (players + admins)."],
  ["Next game", "Declined list", "next", "Same row."],
  ["Next game", "No-show marking", "bug", "API exists, no UI anywhere. Belongs on a post-game Lineup screen."],
  ["Next game", "Claim / merge player", "page", "Rankings and invite pages, unchanged."],
  ["Next game", "Teams: list / pitch, swap, drag, formations", "next", "Teams block + “Pitch view”."],
  ["Next game", "Randomize, re-randomize, early draw (owner)", "next", "“Draw teams now” / “Draw again” for admins; auto-draw when full."],
  ["Next game", "Team rename (admin)", "next", "Pencil on the team heading."],
  ["Next game", "Elo chips, crew chips, rank delta in teams", "keep", "Unchanged rules (balanced && !hideElo)."],
  // ───── sheet
  ["⋮ More sheet", "Calendar (.ics, Google; hidden when past today)", "sheet", "Shown for the next game."],
  ["⋮ More sheet", "History, Seasons, Attendance, Ratings, Activity log, Payments, Watch score", "sheet", "Same destinations, grouped under Look back."],
  ["⋮ More sheet", "My notifications (mute switches, invite opt-out)", "sheet", "Signed-in only."],
  ["⋮ More sheet", "Cancel game (admin)", "sheet", "Danger-coloured, confirm dialog (extra note for recurring)."],
  ["⋮ More sheet", "Settings (admin)", "sheet", "Opens the settings page."],
  // ───── elsewhere
  ["Settings page", "General, competition, features (cost split, MVP, positions), priority list", "page", "Unchanged."],
  ["Settings page", "Access password, invite list, admins, archive, relinquish, webhooks", "page", "Unchanged."],
  ["Settings page", "Transfer ownership", "bug", "API only; feature-parity.yaml says web ✅ but no UI."],
  ["Payments page", "Cost editing (this game / all future), payer settings, settle-up", "page", "Unchanged. /settle is unlinked today."],
  // ───── notifications / virality
  ["Notifications", "Push prompt banner and the high-intent modal near kickoff", "next", "Banner after “All done” (stage 2). Modal near kickoff stays, but never while tasks are pending."],
  ["Notifications", "Created-game share nudge (?created=1), Invite share dialog", "keep", "Unchanged dialogs."],
  ["Notifications", "Invite banner for ?inviteToken (accept/decline/claim)", "keep", "Mounts at the very top, above the header."],
  ["Notifications", "Deep links ?action=join|pay|rsvp|add-score|confirm-payment, ?player", "keep", "join→RSVP, pay→Pay row, rsvp→scroll to RSVP, add-score→score card, confirm-payment→Payments."],
  ["Notifications", "SSR summary, JSON-LD, og meta", "keep", "Must describe the next game and last result."],
  // ───── states
  ["States", "Loading skeleton, not found (“create a new game”), password lock", "keep", "Unchanged full-page states."],
  ["States", "Offline / fetch error", "bug", "Web has no offline banner (Android does). Add a stale banner."],
  ["States", "Game full, not enough players", "next", "Bench row; “Draw teams now” for admins."],
  ["States", "One-off (non-recurring) event", "next", "No next game: recap stays, “Play again?” block. Scenario “One-off”."],
  ["States", "Archived", "header", "Chip only today; page stays active (decide whether to lock)."],
  // ───── parity
  ["Android / Wear", "Android: Join and Add are not gated after the game ends (server returns 403)", "bug", "Fix in the same change."],
  ["Android / Wear", "Android: pendingShareInvite set but no UI reads it (share sheet never opens)", "bug", "Fix or remove."],
  ["Android / Wear", "Android: “Vote MVP” opens History, which has no voting", "bug", "Inline chips are the real path; button is a dead end."],
  ["Android / Wear", "Web: reorder sends EventPlayer ids, server compares legacy Player ids (unverified)", "bug", "Verify before relying on drag reorder."],
  ["Android / Wear", "Wear: can't RSVP, pay or share; has score, teams, add-player (known players only), MVP", "keep", "No Wear change from this redesign. Manifest wrongly says Wear lacks history/MVP."],
];

const SECTIONS = Array.from(new Set(ROWS.map((r) => r[0])));

export function PrototypeCoverage() {
  const [filter, setFilter] = useState<Where | "all">("all");
  const counts = ROWS.reduce<Record<string, number>>((a, r) => { a[r[2]] = (a[r[2]] ?? 0) + 1; return a; }, {});
  return (
    <Box sx={{ maxWidth: 1000, mx: "auto", bgcolor: "#fff", borderRadius: 3, p: 3, boxShadow: 3 }}>
      <Typography sx={{ fontSize: 24, fontWeight: 800, color: "#1f2933" }}>Coverage: where everything on today's event page goes</Typography>
      <Typography sx={{ fontSize: 15, color: "#52606d", mb: 2 }}>
        {ROWS.length} items from the web, Android and Wear audit. Each is placed in the redesign, parked on a named page, left as an unchanged component, dropped, or flagged as a bug.
      </Typography>
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, mb: 3 }}>
        <Box component="button" onClick={() => setFilter("all")} sx={{ cursor: "pointer", border: "2px solid", borderColor: filter === "all" ? "#1f2933" : "transparent", bgcolor: "#f0f2f5", borderRadius: 999, px: 1.5, py: 0.5, fontSize: 13, fontWeight: 700, color: "#1f2933" }}>All ({ROWS.length})</Box>
        {(Object.keys(WHERE) as Where[]).map((k) => (
          <Box key={k} component="button" onClick={() => setFilter(k)} sx={{ cursor: "pointer", border: "2px solid", borderColor: filter === k ? WHERE[k].color : "transparent", bgcolor: WHERE[k].bg, color: WHERE[k].color, borderRadius: 999, px: 1.5, py: 0.5, fontSize: 13, fontWeight: 700 }}>
            {WHERE[k].label} ({counts[k] ?? 0})
          </Box>
        ))}
      </Box>
      {SECTIONS.map((s) => {
        const rows = ROWS.filter((r) => r[0] === s && (filter === "all" || r[2] === filter));
        if (!rows.length) return null;
        return (
          <Box key={s} sx={{ mb: 3 }}>
            <Typography sx={{ fontSize: 16, fontWeight: 800, color: "#1f2933", mb: 1 }}>{s}</Typography>
            {rows.map((r, i) => (
              <Box key={i} sx={{ display: "grid", gridTemplateColumns: "1.3fr 170px 1.6fr", gap: 2, py: 1, borderTop: "1px solid #e4e7eb", alignItems: "start" }}>
                <Typography sx={{ fontSize: 14, color: "#1f2933" }}>{r[1]}</Typography>
                <Box sx={{ justifySelf: "start", bgcolor: WHERE[r[2]].bg, color: WHERE[r[2]].color, fontSize: 12, fontWeight: 700, borderRadius: 999, px: 1.25, py: 0.4 }}>{WHERE[r[2]].label}</Box>
                <Typography sx={{ fontSize: 13, color: "#52606d" }}>{r[3]}</Typography>
              </Box>
            ))}
          </Box>
        );
      })}
    </Box>
  );
}
