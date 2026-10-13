# Season Stakes Preview on the team view

Status: accepted

## Context

The Seasonal Rank Ladder (ADR 0031) and the friendly-competition pilot deliberately kept
competition information off the Event page ("The Event page continues to focus on the next
Game. Competition information does not get a dashboard, banner, or standings block there"),
and Crew scores were specified to display two decimal places while ranking on unrounded
values. A request asked that, while teams are being set, participants see which Crew each
lineup player belongs to, the points each earns if their side wins, and whether the result
would move a player's Rank or a Crew's standings position.

## Decision

Add a participant-only **Stakes Preview** to the team view of the Event's next **unscored,
non-friendly Game** (once the score is in, or the Game is Friendly, there is nothing left to
project). Using the current lineups it projects the three side results (Side A wins / draw /
Side B wins), showing each player's **Crew**, their **Season Contribution** (3/1/0), each
Crew's resulting **Crew Round Score**, and the per-scenario Crew standings position. Season
Rank moves against the mean Skill Rating of the opposing lineup. Projections are shown only
while the Season still has an available Season Round (fewer than eight eligible Games played).

**Disclosure.** Any Season participant sees every lineup player's **Crew and points**. A
player's **Rank movement is private**: the response carries the viewer's own projected delta
and place movement only, matching the rest of the codebase (`rank.ts` strips the shared
`deltas`). When the Event sets `showCompetitiveData = false`, the preview is hidden from
everyone but the owner/admin, matching `computeLeaderboardPayload`.

**Presentation.** Crew scores display as whole numbers (half-up) on **both** the preview and
the Crew standings table, which supersedes the pilot's two-decimal Crew display; ranking and
tie-breaks continue to use raw values. Withdrawn members are excluded from projected Crew
means (withdrawal stops contribution), and only Crews the real standings table would show — or
that are fielding someone now — appear in the projected race.

The projection is computed **server-side** and returned whole; the client never receives raw
**Skill Rating** values. This preserves the Rank-transparency rule (Skill Rating is
owner/admin-only) while still letting the strip respond to the lineups that are actually set.
Contribution points and Crew Round Scores depend only on which side a player is on, so the
client may re-derive them live as the organizer drags players; Rank and standings movement
refresh when the request settles.

## Why

The preview is a deliberate, participant-only relaxation of the pilot's "no competition info
on the Event page" rule: it rewards opt-in without pressuring non-participants, and stays
collapsed so it never dominates the ordinary weekly game. Whole-number Crew scores remove the
fractional averages participants found confusing without changing who is ranked where.

## Considered Options

- **Round the value, not just the display.** Rejected: it rewrites the ranking basis, changes
  results, and multiplies ties, for no benefit over clean display numbers.
- **A post-hoc scenario board only (no inline strip).** Rejected: the tension while building
  teams is the point; the inline strip is the primary surface, with the board on tap.
- **Ship per-player Skill to the client and compute scenarios there.** Rejected: Skill Rating
  is hidden by design, so the client would have to receive a value it must never see.
