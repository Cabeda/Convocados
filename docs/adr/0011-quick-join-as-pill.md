# Quick Join as a pill in the PlayerList row

The Quick Join affordance for an authenticated user joining a Game with their own account is rendered as the first pill in the PlayerList pills row, not as a separate panel above it. The previous `<QuickJoin>` panel (gradient background, separate "Join this game" heading, social-proof line, streak chip, debt alert) was collapsed into a single filled `Chip` with the user's name. The `PaymentNudgeDialog` (the existing modal that surfaces outstanding balances before a join) is preserved — opened by the pill click when the user has debt, or auto-opened from a `?action=pay` deep link.

## Status

Accepted, 2026-06-12.

## Considered options

1. **Pill in the PlayerList row, dialog preserved** (chosen). Single merged component; the Quick Join affordance is visually the same kind of action as adding a recent player.
2. **Pill, no dialog**. Simpler, but loses the proactive debt-warning UX on Quick Join.
3. **Keep the panel**. Loses the visual compression the design called for.

## Consequences

- The Quick Join is now always in the same row as recent players. Mobile UX is more consistent — the user sees a row of pills, not a panel + a row of chips.
- The standalone `QuickJoin.tsx` component is gone, replaced by `PaymentNudgeDialog.tsx` (just the dialog) and the pill logic in `PlayerList`.
- The pill routes through the parent (`EventPage`) via `onQuickJoinPillClick`, so the host owns the dialog-vs-direct-join decision. `PlayerList` stays presentational.
- "Join this game as {name}" is a single tap when the user has no debt. With debt, a single tap opens the existing dialog. Friction parity with the panel version, lower visual weight.
