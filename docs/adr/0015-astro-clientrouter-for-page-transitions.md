# ADR 0015: Adopt Astro `<ClientRouter />` for site-wide page transitions

## Status
Accepted

## Context
Every top-level page on the Convocados web app rendered a single React island with `client:only="react"`, mounted on an otherwise empty `<body>`. The body had no background of its own, and the React island was the only thing that painted the dark `#111412` shell. Between the browser parsing `</body>` and the React island's first hydration paint, the user saw the browser default `#fff` background — a visible "white blink" on every navigation.

Top-level pages had no shared `<Layout>` component (`src/layouts/DocsLayout.astro` only wrapped `/docs/*`), so there was nowhere to put a shell paint, a `<meta name="theme-color">` consistently, or a navigation router. The 7 main pages (`/`, `/dashboard`, `/admin`, `/court-watches`, `/public`, `/events/[id]`, `/stats`) each repeated the same doctype/head/body boilerplate.

Separately, every same-origin navigation was a full document load: the React island re-mounted from scratch, all the MUI Emotion styles re-inserted, the session was re-validated, the page scrolled to top, and a new paint replaced the old. The transition was jarring — nothing carried over.

## Decision

1. **Introduce `src/layouts/BaseLayout.astro`** as the shared shell for all 7 top-level pages. It owns:
   - `<head>` (theme-color, manifest, viewport, title, description, canonical, OG tags, JSON-LD via props)
   - A `<style is:inline>` block that paints `html, body { background-color: #111412 }` *before* the React island hydrates. This is the single most important rule — it eliminates the white blink.
   - The `<ClientRouter />` from `astro:transitions` (renamed from `<ViewTransitions />` in Astro 5) with `fallback="animate"`. Astro 6's router intercepts same-origin link clicks and uses the browser's `Document.startViewTransition()` when supported, with a fade fallback otherwise.
   - A `<main>` slot with an optional `view-transition-name` (e.g. `page-dashboard`, `page-event-${id}`) so each page can be addressed individually for shared-element morphs in future.
   - A tiny inline `<script>` that sets `data-astro-transition-direction="forward|back"` on `<html>` before each swap, so the CSS can pick the right keyframe set. `popstate` flips the direction.

2. **Migrate the 7 top-level pages** to use `<BaseLayout>`. Pages keep their existing React island (`client:only="react"`) and page-specific metadata is passed as props.

3. **Native-app slide animation.** A 220ms slide is applied to the `::view-transition-old(root)` and `::view-transition-new(root)` pseudo-elements. Forward navigation slides the new page in from the right and the old out 30% to the left. Back navigation reverses. `prefers-reduced-motion: reduce` disables the animation entirely.

4. **E2E coverage.** `e2e/view-transitions.spec.ts` asserts three invariants:
   - SSR HTML declares the shell background (`#111412`) and `theme-color` (`#1b6b4a`) on every top-level route.
   - A same-origin link click invokes `Document.startViewTransition()` (the document is reused, not reloaded).
   - The body background is never `rgb(255, 255, 255)` at any sampled frame during a navigation, and the shell color appears at least once.

5. **No automatic prefetch.** The current pages are mostly `prerender = true` (cheap to fetch), but `/events/[id]` and `/public` are SSR. Auto-prefetching would multiply DB round-trips on dashboards with 30+ games. Hover-prefetch can be added later per-link as `data-astro-prefetch`.

## Consequences
- **Positive:** No white blink on any top-level navigation. Soft nav keeps the scroll position, the theme color, and the body paint stable. Slide animation makes the app feel like a native PWA.
- **Positive:** Top-level pages now share a single source of truth for `<head>` content, theme color, and shell style. Adding a new top-level page is one BaseLayout call, not 30 lines of boilerplate.
- **Positive:** A future shared-element morph (event card → event detail) is now possible — just give both elements the same `view-transition-name`.
- **Trade-off:** The router adds ~3KB of JS to the bundle. We accept that for the UX win.
- **Trade-off:** The slide animation runs on `view-transition-name: root` by default, so two same-name elements would conflict. Each page uses a unique `view-transition-name` (`page-${route}`) to avoid that.
- **Compatibility:** Browsers without the CSS View Transitions API (pre-Chrome 111, pre-Safari 18, pre-Firefox 131) fall back to Astro's `fallback="animate"` cross-fade. No white blink either way because of the shell paint.
- **Test surface:** Existing Playwright tests (43 of them) all pass without modification — the layout migration is backward-compatible with full-page navigations and with `request.get(path)` checks.
- **Future work:** If we want a true SPA shell (persistent AppBar, no React island re-mount), we'd need to lift the `<ResponsiveLayout>` outside the island and use `transition:persist` on it. Not done now because the islands are full apps (`LandingPageWithProviders`, `DashboardPage`, `EventPage`, etc.) and the persistent-shell refactor is a larger change than this ADR.
