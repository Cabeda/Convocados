# Post-auth destination survives login, on web and Android

Auth flows on both clients must respect the user's entry point. Tapping a link to `/events/<id>` while signed out, signing in, and being dropped on `/dashboard` (web) or the Games list (Android) violates the "remain in the app where the user was" expectation and breaks deep-link share/notification/payment-reminder entry points. The fix is a uniform rule: **the callbackURL captured at the signin entry point is the same callbackURL honored at the signin exit point**, on every transport.

## Status

Proposed, 2026-06-22.

## Context

P2 bug report: "users open the app on an event, login and are redirected to the main page. ... if they are still not following the event they can't access it because everytime they click on the link it doesn't show them logged in." Same shape on Android via deep link.

Four distinct defects found in the current implementation:

1. **Web — signin form falls back to native GET submit.** `SignInPage.tsx:184` and `SignUpPage.tsx:63` use `<Stack component="form" onSubmit={handler}>` with no `action` or `method`. The form's defaults are `action = currentURL` and `method = get`. React's `onSubmit` calls `e.preventDefault()` so the JS path is fine — but **if a user clicks the submit button before React has hydrated** (slow mobile network, dev mode with HMR-induced unmount, or any script-load failure), the browser does a native GET to the same signin URL with `?email=...&password=...` appended. The signin API is never called, the session is never created, the user remains on the signin page. The query string also leaks the password to referrer headers, server access logs, and browser history. Confirmed in both dev and prod builds via the production-bundled `dist/` server (form attributes: `action = /auth/signin?callbackURL=...`, `method = get`).

2. **Web — signin page has no fallback for missing callbackURL.** `SignInPage.tsx:32` defaults to `callbackURL = "/"`, which is then mapped to `/dashboard` (line 35). Every "Sign in" entry point in the app (the header link at `ResponsiveLayout.tsx:473`, the various empty-state CTAs in `DashboardPage.tsx:178`, `PlayerStatsPage.tsx:125`, `AdminDashboardPage.tsx:251`) explicitly passes a callbackURL — so the only way to land on signin without one is a stale bookmark or an out-of-band OAuth callback. The default of `/` then to `/dashboard` is defensible, but a user who entered via a notification/email link that lost its query string will still bounce to the dashboard. A safer default is "the current page the user is on," captured at signin render time and stored in a per-page HOC like the header already does.

3. **Android — `MainActivity.extractDeepLink` ignores `Intent.data`.** `MainActivity.kt:49-53` reads only `intent.getStringExtra("deep_link")` and `intent.getStringExtra("navigate_to")`. A `convocados://events/<id>` URL from a push notification, share, or `EventCard` deep-link fires the `BROWSABLE` intent-filter in `AndroidManifest.xml:29-34` and arrives as `Intent.data = Uri.parse("convocados://events/<id>")` — **not as an extra string**. The method returns `null`, the `deepLink` state stays empty, the user lands on Login or Games with no record of the original target. After `AuthManager.handleCallback` exchanges the OAuth code, the `LaunchedEffect(deepLink, isAuthenticated)` in `AppNavigation.kt:58-64` has no deep link to honor and the user stays on Games. To the user this looks like "the app logs me out every time I tap a link."

4. **Android — `LoginScreen.onLoginSuccess` is dead code.** `AppNavigation.kt:113` passes `onLoginSuccess = { navController.navigate(Games) { popUpTo(Login) { inclusive = true } } }` to `LoginScreen`, but `LoginScreen.kt:34,50-57` never calls it — the "Sign in" button only calls `authManager.startLogin(context as Activity)`, which opens a Custom Tab and exits the Compose flow. Login → Games transition happens implicitly when `isAuthenticated` flips and the `NavHost` rebuilds with `Route.Games.route` as the new `startDestination`. The dead `onLoginSuccess` callback is harmless on its own, but it hides the actual mechanism (the recomposition) and makes future "preserve deep link across login" work harder to reason about.

## Decision

Treat the post-auth destination as a **first-class field on the auth flow**, not a property of the entry component. All clients must capture it at signin start and honor it at signin end. Concrete changes:

- **Web forms** — every `<form>` element must set explicit `action` and `method` attributes (`action = "/api/auth/sign-in/email"` and `method = "post"`, or a no-op `action = "#"` if the form is purely a JS handler). The `<Stack component="form">` pattern is replaced with `<form onSubmit={handler} action="#" method="post">` so a click before hydration does a no-op POST to the same page (page refreshes, form state resets) instead of a credential-leaking GET to the signin URL with form fields in the query string.
- **Web signin entry points** — the `SignIn` link in `ResponsiveLayout` (and any other entry that doesn't already capture the current path) snapshots `window.location.pathname + window.location.search` at render time and threads it through `?callbackURL=`. The signin page's `/` → `/dashboard` default stays for bookmarks but is logged at warn level so missing-callbackURL cases are visible in production.
- **Android `extractDeepLink`** — the method now reads `intent.data` first, then `getStringExtra`, and resolves the URI to a navigation route via the existing `deepLinkToRoute` helper in `AppNavigation.kt:295-308`. The `intentVersion` increment in `MainActivity.onNewIntent` already triggers `RootViewModel.handleIntent`, so the deep link survives both cold-start and warm-resume.
- **Android login flow** — `LoginScreen.onLoginSuccess` is removed. The post-auth navigation is owned by a single `LaunchedEffect` keyed on `(deepLink, isAuthenticated)`: when `isAuthenticated` flips to true, if `deepLink` is set, navigate to the resolved route; otherwise the existing `startDestination = Games` recomposition handles the default. The single-source-of-truth pattern (one effect owns the post-login navigation) replaces the current split between `onLoginSuccess` (dead) and the LaunchedEffect (only fires for already-authenticated sessions).
- **Cross-client invariant** — the `callbackURL` is never widened into an open-redirect vector. The web `SignInPage` continues to reject `//`-prefixed values. The Android `deepLinkToRoute` resolves only to in-app `Route.*` paths, never to external URLs.

## Consequences

- The web form bug is fully eliminated by the `action="#"` change — there is no longer a path where a click-before-hydration leaks the password in the URL or silently fails the signin.
- The Android deep link fix unblocks every existing entry point that uses `convocados://` (share buttons, push notifications, payment reminders via `?action=pay`) without changing the call sites.
- Removing the dead `onLoginSuccess` callback tightens the mental model: post-login navigation has exactly one implementation site.
- A user who arrives via a link with a stale or missing `callbackURL` is routed to the dashboard (web) or Games (Android) as before, with a warn-level log line so we can detect the upstream link rot.
- The `better-auth.state` cookie contract is unchanged. The fix is purely on the client side; no server changes.
- Future additions (e.g. iOS deep links, passwordless magic links on Android) plug into the same `(deepLink, isAuthenticated)` effect.

## Alternatives considered

- **Server-driven post-auth destination** (return the destination in the OAuth state as today, but have the client ignore it and read the Referer header). Rejected: Referer is unreliable (privacy modes strip it, cross-origin Referer drops the path), and a server-driven destination puts auth state where the entry point can't influence it.
- **Always redirect to `/dashboard` after login.** Rejected: it's the bug we're fixing. The "main page" experience is what the user reported, and it's hostile to deep-link entry.
- **A separate `/post-auth` route that reads a short-lived cookie set at signin time.** Rejected: the cookie is the same shape as the OAuth state we already have, so it's a parallel mechanism for no benefit. The `callbackURL` query param is the existing standard and works.
- **Fix only the Android bug and ship a web hotfix later.** Rejected: the two bugs are independent in code but identical in user-visible behavior (drop the user on the wrong page). Splitting the fix doubles the QA surface and leaves the password-leak defect (defect 1) in the wild.
