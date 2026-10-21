# ADR 0054 — iOS is served by the PWA: no native iOS app

**Status:** accepted
**Date:** 2026-10-21
**Source:** grilling 2026-10-21 (issues #1069, #1156)

## Context

The repository carries a native iOS app (SwiftUI) and an open question about iOS push:
#1069 asked whether to fund the Apple Developer Program ($100/yr, the `aps-environment`
entitlement, a physical device) and build an APNs sender (a p8 auth key, key/team IDs, an
HTTP/2 sender), or to standardise on the PWA's web-push path. #1156 asked for the signed-in
Home (Up next + Discover) on the iOS app.

The facts that decide it:

- The PWA already delivers to iPhone. The manifest is `display: standalone`, the service
  worker and the VAPID path are in place, so "Add to Home Screen, then enable notifications"
  is a working iOS client.
- The server has no APNs sender and never had one. `sendAppPushToUser` and
  `sendAppPushToEventUsers` read every `AppPushToken` row and hand it to FCM with no
  platform filter, so an `ios` token is rejected and deleted. Production holds 0 `ios`
  tokens and 326 Android ones: no iPhone in the product's real use receives an app push.
- The native iOS app is not a release surface. It is not in the App Store, it has no
  pipeline, and nothing in this repository's release workflow builds it. Its "full Android
  parity" is a claim in an issue, not a shipped fact.

Against that, the cost of the alternative is not only money: an APNs sender is a second push
transport to maintain, with its own credentials, its own failure modes and its own token
lifecycle, for a platform the product reaches already.

The mission asks one question of every change — does this let people play more, with less
administration? — and the product's iOS users are the same people as its web users: they
open a page, add it to the home screen, and get the notification.

## Decision

**The PWA is the iOS client.** (Cabeda, grilling 2026-10-21)

- No native iOS app is built, and the existing one is not kept in parity with the web or
  the Android surfaces. #1156 closes with this ADR.
- No APNs sender, no Apple Developer Program, no APNs tokens. #1069 closes with this ADR.
- Web push is the iOS delivery path. It already works; the guidance is "Add to Home Screen,
  then enable notifications".
- One defect survives the decision and is filed on its own (#1482): the server must not
  delete a token because FCM rejected it. A token the server cannot use must not be
  destroyed.

The decision is about *building*, not about the product's reach: an iPhone user is served,
and the product keeps one client per platform it ships.

## Consequences

- The roadmap carries one iOS surface instead of two. A feature that lands on the web and
  Android reaches iPhone users through the PWA without a second implementation.
- The parity language in the issues changes: "iOS app parity" is no longer a backlog item,
  and a feature that reaches the PWA counts as reaching iOS.
- The native iOS app's code is not deleted by this ADR. It stays where it is, unmaintained;
  removing it is a separate decision with its own blast radius.
- The $100/yr and the second transport do not exist, so the push stack stays one stack:
  FCM for the Android app, VAPID for the web and the PWA.
- The token-deletion defect (#1482) is a real bug under this decision too: a client that
  registers a token the server cannot use loses it silently.
