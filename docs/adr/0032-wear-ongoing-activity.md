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
3. **No tile.** The app has no tile, so the guideline's "reference the ongoing
   activity from the tile" clause does not apply. If a tile is added, it must
   reference the ongoing activity.
4. **POST_NOTIFICATIONS is requested** on API 33+ at launch, because the ongoing
   notification (and therefore the activity indicator) cannot render without it.
5. **Content stays inside the display.** Score and quick-game content is laid
   out within `ScreenScaffold`'s content padding, and round- plus square-display
   Roborazzi screenshots guard against text or controls being clipped.

## Consequences

- An in-progress score is visible from the watch face without reopening the app,
  satisfying the policy and matching user expectation for a live scoreboard.
- The notification is low-importance and silent, so it never makes sound while
  scoring.
- If the notification permission is denied, the activity indicator cannot show;
  the app still functions, but the policy affordance is unavailable until the
  user grants permission.
- Screenshot tests now cover both display shapes; a regression that clips
  content on round or square is visible in review.
