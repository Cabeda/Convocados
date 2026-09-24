# 0032 — Wear live score as an Ongoing Activity

**Status:** Accepted
**Date:** 2026-09-10

## Context

Google Play rejected the Wear app under the Wear App Quality Guidelines for a
missing ongoing activity. The app holds the watch display awake while an
organizer scores a game (`RememberKeepScreenOn`) but posted no ongoing
notification, so the watch face showed no activity indicator and the recent-apps
chip was empty. A second finding, "Watch shapes", flagged content that did not
fit the physical display area.

## Decision

1. **Live scoring is an Ongoing Activity.** Both the server-backed live Game
   score and the local Quick Game post an ongoing notification paired with
   `androidx.wear:wear-ongoing`'s `OngoingActivity`. That pairing is what makes
   Wear OS render the watch-face indicator and the recent-apps chip.
2. **The indicator follows the live session while its screen is present.** A
   live Game is ongoing once scoring has started and until the game window ends;
   a Quick Game is ongoing from kickoff until its duration elapses. The
   notification text is the running score, refreshed as it changes. It clears
   when the session ends or the scoring screen leaves composition.
3. **Post the notification, don't just decorate it.** `OngoingActivity.apply(context)`
   only attaches the ongoing-activity metadata to the `NotificationCompat.Builder`;
   it does **not** post anything. The screen must call
   `NotificationManagerCompat.notify(...)` itself, otherwise the watch-face
   indicator and the recents chip never render — this was the actual cause of the
   second "Missing ongoing activity" rejection.
4. **Tiles and the chip deep-link into the running session.** The ongoing
   activity's touch intent and the quick-game tile both carry an `OngoingLaunch`
   extra (`eventId` or `quickGame`), and `WearActivity` (now `singleTask`) routes
   the start destination to the live `ScoreScreen` / `QuickScoreScreen` instead
   of the games list. Opening the app from the chip or tile must *resume the
   game*, not land on the list — a re-tap while the app is alive is delivered via
   `onNewIntent` and re-navigates. (Play's tile guidance: tapping an in-progress
   tile shows the in-progress activity.)
5. **The status is the live score.** The `OngoingActivity` carries a
   `Status.TextPart` with the running score, so the chip/recents surface is
   glanceable rather than a bare icon.
6. **The indicator outlives the screen.** `RememberOngoingActivity` clears the
   activity only when the session is no longer live
   (`shouldClearOngoing(enabled)`), never merely because the score screen left
   composition. Navigating to Teams/Save mid-game must not drop the indicator;
   explicit end/save actions stop it.
7. **POST_NOTIFICATIONS is requested** on API 33+ at launch, because the ongoing
   notification (and therefore the activity indicator) cannot render without it.
8. **Content stays inside the display.** Wide controls near the top/bottom of a
   round display are constrained to the display's inscribed square
   (`ROUND_SAFE_FRACTION` / `roundSafeWidth` / `roundSafeSize`), because
   `ScreenScaffold`'s content padding is a fixed percentage that is not
   shape-aware. Round- and square-display Roborazzi screenshots — including small
   round (227dp) and scrolled-to-the-bottom captures — guard against clipping.

## Consequences

- An in-progress score is visible from the watch face without reopening the app,
  satisfying the policy and matching user expectation for a live scoreboard.
- The notification is low-importance and silent, so it never makes sound while
  scoring.
- If the notification permission is denied, the activity indicator cannot show;
  the app still functions, but the policy affordance is unavailable until the
  user grants permission.
- Screenshot tests now cover both display shapes and the compact round form
  factor; a regression that clips content on round or square is visible in review.
