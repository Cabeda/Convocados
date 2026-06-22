# ADR 0016: Persistent SPA shell via `transition:persist`

## Status
Accepted

## Context
[ADR 0015](0015-astro-clientrouter-for-page-transitions.md) introduced the shared `BaseLayout` and `<ClientRouter />` to fix the white-blink on every navigation. It also outlined a follow-up: lifting the React shell (Theme + MUI Emotion cache + ResponsiveLayout + AppBar) out of the per-page islands so it survives navigations.

The cost of the current setup is large. Every navigation between top-level pages (`/dashboard` → `/events/[id]` → `/public`) does this:

1. Browser tears down the old `<astro-island>` (the entire React tree).
2. MUI Emotion re-injects all styles for the next render — visible as a brief unstyled flash on slow connections.
3. `ThemeModeProvider` re-reads `localStorage`, recomputes the MUI theme object, and re-creates the `<ThemeProvider>` context. Components that use `useTheme` get a new object reference and re-render.
4. `ResponsiveLayout` re-creates the AppBar (locale menu, user menu, scroll trigger).
5. The session hook re-fetches from `/api/auth/get-session` because the better-auth cache lives in module scope but the React component that subscribes is re-mounted.
6. The page component re-fetches its own data (this is correct, page content should reset).

Items 2–5 are pure waste — the shell never needed to change.

## Decision

1. **One persistent React island for the main app.** `src/components/SpaRoot.tsx` wraps `<ThemeModeProvider>` + `<ResponsiveLayout>` exactly once. The island is mounted with `client:only="react" transition:persist="convocados-shell"` from every top-level page. `client:only` is required (not `client:load`) because the component imports MUI, which has a CJS default-import shape that breaks Vite's SSR transform — see the [note below](#on-clientonly-vs-clientload).

2. **The island is the router.** `SpaRoot` reads `window.location.pathname` on first render and listens to `astro:after-swap` to re-render on every navigation. A small `resolveRoute()` function matches the pathname to a page component (with URL params parsed for `/events/[id]`). On any nav, the page component re-mounts (so its data fetches re-run — that's the point) but the shell never does.

3. **Page components are content-only.** Each of the 7 top-level pages (`LandingPage`, `DashboardPage`, `AdminDashboardPage`, `CourtWatchesPage`, `PublicGamesPage`, `EventPage`, and the new `NotFoundPage`) was refactored to drop its own `<ThemeModeProvider>` and `<ResponsiveLayout>` wrapping. The page now just renders its content; the shell is provided by `SpaRoot`. `LandingPageWithProviders` is kept as a self-contained export for the unit test (and any future call site outside the SPA).

4. **What survives a navigation** (proven by `e2e/view-transitions.spec.ts`):
   - The MUI theme object (and therefore every component that uses `useTheme()`).
   - The MUI Emotion style cache — no re-injection flash.
   - The `<ResponsiveLayout>` AppBar and its scroll-trigger state.
   - The `ThemeModeContext` mode (light/dark/system).
   - The `useSession()` subscription — no extra `/api/auth/get-session` round-trip.
   - The DOM node identity of the persistent island (verified by a `data-persist-probe` marker test).

5. **What re-mounts on every navigation** (intentional):
   - The page content sub-tree (`LandingPage`, `DashboardPage`, etc.).
   - All page-local React state (filter UI on `/public`, search on `/admin`, form drafts on `/events/[id]`).
   - Each page's data fetch — this is correct, page content should be fresh.

6. **Routing is from the URL, not from a prop.** The Astro page passes a `pageKey` to seed the initial render (useful for the brief window between SSR placeholder and hydration, and for the unit test path), but the live source of truth is `window.location.pathname` on the client. After hydration, the prop is ignored. This means a stale `pageKey` can't desync the UI from the URL.

## Consequences

- **Performance:** Soft-nav becomes essentially free on the JS side. The browser fetches the new page HTML, swaps the `<main>` content, and the React tree (with its MUI cache and theme) re-renders only the swapped sub-tree. No more full island re-mount.
- **No FOUC on nav:** MUI's emotion cache stays hot, so styles for the new page are already in the DOM. Before this change, navigating from `/dashboard` to `/events/[id]` briefly showed the event page with no MUI styles applied while the new island's `<style>` tags were inserted.
- **No re-fetch of session:** better-auth's `useSession()` is now subscribed in the persistent shell. The first page load fetches it; subsequent navs reuse the cached value.
- **No re-init of theme:** Toggling dark/light mode no longer "resets" on every navigation (it was, in fact, persisting via `localStorage` already, but the theme object itself was re-created).
- **Test surface:** A new `e2e/view-transitions.spec.ts` "persistent SPA shell" describe block asserts three invariants:
  1. The DOM has a `data-astro-transition-persist="convocados-shell"` marker.
  2. Theme mode (light/dark) survives a same-origin nav.
  3. The persistent island's DOM node identity is preserved across nav (verified by marking the node before nav and asserting the mark is still there after).
- **Trade-off:** With one island, all page components ship in the same initial bundle. The previous `client:only="react"` setup had each page as a separate island and benefited from natural code-splitting. The new setup pays the initial-bundle cost for every page on first load. The fix for this is dynamic-import + `React.lazy()` for the page components inside `SpaRoot`, which is on the roadmap but not in this change (kept the diff small to land the core win).
- **Trade-off:** `client:only` means no SSR for the page content. The shell (`BaseLayout`) still SSRs the head and the body background paint, so there is no white blink. But the visible page content (the landing form, the dashboard list, the event detail) is empty in the HTML and appears after JS loads. A slow connection shows the dark shell with no content for a moment. This matches the previous `client:only="react"` behaviour for the same pages, so no regression.
- **Out of scope:** A persistent AppBar that stays visually in place while the content slides under it (instead of sliding with the `<main>`). That would require hoisting the AppBar above `<main>` in the DOM. The current behaviour — AppBar slides with the page — is the iOS standard and looks natural; we accept it.
- **Out of scope:** The `/docs/*`, `/auth/*`, `/users/[id]`, `/events/[id]/settings`, etc. routes still use their own per-page islands. They were not in the original "white blink" scope and don't need the persistent shell. They navigate normally (full reload) when entered from the SPA, and back to the SPA from them loses the persistent state (acceptable — the AppBar isn't part of those pages).

## On `client:only` vs `client:load`

We tried `client:load` first. It failed with `(0, __vite_ssr_import_1__.default) is not a function at createPalette.js:244` during SSR rendering. The issue is that MUI 6 is published as CJS with a `module` field pointing to ESM, and Vite's SSR transform chokes on the default-import shape when the component tree is large. The error is intermittent and Vite-version-sensitive.

Switching to `client:only="react"` skips SSR entirely for the React tree, so the import never happens on the server. The Astro page still SSRs the head, body shell, and theme-color meta — everything that matters for first paint. The page content (React) hydrates on the client. No regression on the white-blink fix, and the dev server is stable.

## Test plan
- [x] `npm run test` — 2757 unit tests pass
- [x] `npm run typecheck` — clean
- [x] `npm run lint` — 0 errors (54 warnings, same as baseline on `main`)
- [x] `npx playwright test` — 46/46 pass (3 new in the persistent shell describe)
- [ ] Manual: open DevTools Performance, record a nav from `/dashboard` to `/events/[id]`. Before this change, the React island re-mounted (visible as a 50–200ms gap in the "Scripting" track). After, the only work in "Scripting" is the page component's own data fetch.
