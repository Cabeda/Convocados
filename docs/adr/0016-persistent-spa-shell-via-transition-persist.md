# ADR 0016: Persistent SPA shell via `transition:persist` — **REJECTED**

## Status
Rejected (reverted before merge). The persistent shell works in theory but, with `client:only="react"`, breaks at runtime: the React root gets detached on the first navigation, leaving the page blank.

## Context
[ADR 0015](0015-astro-clientrouter-for-page-transitions.md) introduced the shared `BaseLayout` and `<ClientRouter />` to fix the white-blink on every navigation. ADR 0015 outlined a follow-up: lifting the React shell (Theme + MUI Emotion cache + ResponsiveLayout + AppBar) out of the per-page islands so it survives navigations.

## Attempted approach (now reverted)

1. **One persistent React island for the main app.** `src/components/SpaRoot.tsx` wrapped `<ThemeModeProvider>` + `<ResponsiveLayout>` once. Mounted with `client:only="react" transition:persist="convocados-shell" data-astro-transition-persist-props` from every top-level page.
2. **Router from the URL.** SpaRoot read `window.location.pathname`, listened to `astro:after-swap`, and re-rendered the right page component.
3. **Page components content-only** (no per-page shell wrapping).

## What went wrong

After the first same-origin navigation, the persistent island's React tree became empty. Diagnostic findings:

- The React component **did re-render** (`setPathname` was called, the render function ran, the new `useMemo` resolved to the right page).
- The React `useEffect` **did run** (wrote to `localStorage` with the new pathname).
- The body attribute wrote by the render **did appear** in the DOM.
- But the **rendered JSX did not commit to the DOM** — the `<astro-island>` element's `innerHTML` stayed at 0 bytes after the nav.

The cause: with `client:only` + `transition:persist`, the persistent island's React root (`__reactContainer$`) is detached on the first swap. The DOM element survives, but the React root that owns it is gone — so subsequent renders go nowhere.

### Attempted mitigations (all failed)

1. **`data-astro-transition-persist-props`**: tells Astro not to re-hydrate the island with new props. Preserves the React root **on the first nav**, but on the **second** nav the root is still detached.
2. **Listen to `astro:after-swap` and update `useState`**: state updates correctly, but the render output doesn't reach the DOM (root is detached).
3. **Drop `transition:persist` entirely**: with no persistence, the new island's React component should remount and render the new page — but the same symptom (empty innerHTML) appears, because the iframe-based `client:only` swap mechanism doesn't work with Astro's view transitions for the persistent component.

### Why `client:load` doesn't work either

We tried `client:load` to avoid the `client:only` iframe mechanism. It fails with `(0, __vite_ssr_import_1__.default) is not a function at createPalette.js:244` during SSR rendering. The cause is that MUI 6 is published as CJS with a `module` field pointing to ESM, and Vite's SSR transform chokes on the default-import shape when the React tree is large. This is a Vite-version-sensitive, intermittent failure.

## Decision (revert)

**The persistent shell is reverted.** Each page renders its own React island (`client:only="react"`) with its own `<ThemeModeProvider><ResponsiveLayout>` wrapping. The base behavior is the same as before the PR:

- Per-page island mounts on each navigation
- MUI re-injects styles briefly on nav (visible as a tiny FOUC)
- Theme is read from `localStorage` on each page (preserved across navs by the storage layer, not by React)
- The Astro `<ClientRouter />` + view transition animation still give the "native-app" slide

The white-blink fix from ADR 0015 is **preserved**: the `BaseLayout` shell paint (`html, body { background: #111412 }`) is inline in the `<head>`, so the browser paints the dark background before any React hydration happens. No `#fff` flash on nav.

## What this PR does ship

- `BaseLayout` with shell paint, `<ClientRouter />`, and 220ms slide animation
- `frame-ancestors 'self'` (changed from `'none'`) so Astro's `client:only` iframe can load same-origin
- `X-Frame-Options: SAMEORIGIN` (changed from `DENY`) for the same reason
- 6 e2e tests covering SSR HTML, soft nav, no white-blink, and persistent DOM identity (the persistent React state assertions are removed)

## What this PR does NOT ship

- Persistent React state across navigations
- Persistent MUI Emotion cache
- The static AppBar pattern (AppBar slides with the page)

## Path forward (future work)

To make the persistent shell actually work, one of these needs to happen:

1. **Astro fixes the `client:only` + `transition:persist` interaction** so the React root survives the swap. Track upstream.
2. **We switch to `client:load`** and fix the Vite SSR issue (probably by adding MUI to `vite.optimizeDeps.include` and pinning Vite versions, or by switching to a different MUI-bundling approach).
3. **We split the shell from the page** so the AppBar lives in a non-React Astro fragment outside the React tree, and the React state lives in a non-persistent island that re-mounts on nav (giving up on the persistent React state goal but keeping a visually-stable AppBar).

## Reverted to: per-page islands

For now, the simplest correct thing: each page renders its own React island. The `BaseLayout` shell paint prevents the white blink. The view transition animation gives the native-app feel. The persistent shell is a future improvement tracked in the GitHub issues.
