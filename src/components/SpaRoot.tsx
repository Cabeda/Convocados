/* eslint-disable @typescript-eslint/no-explicit-any, @eslint-react/static-components -- The router stores page components in a typed registry; the useMemo just instantiates the element for the resolved route. */
/**
 * SpaRoot — the single persistent React island for the main app.
 *
 * One island owns the entire app shell (ThemeModeProvider + ResponsiveLayout).
 * The island is mounted with `transition:persist="convocados-shell"` from every
 * top-level page, so Astro's ClientRouter keeps the same DOM node — and the
 * same React state — across same-origin navigations. The page content swaps;
 * the theme, MUI Emotion cache, AppBar, locale provider and session client
 * survive the navigation.
 *
 * Why one island, not seven:
 *  - The shell components (ThemeModeProvider, ResponsiveLayout, MUI's
 *    ThemeProvider/CssBaseline) all need to live in a single React tree so
 *    the same theme is used by both the AppBar and the page body. Two React
 *    roots would mean two themes and a flash on every nav.
 *  - The MUI Emotion style cache lives on the React tree. One tree = one
 *    cache. Persisted = no style re-injection on nav.
 *  - `useSession()` from better-auth is a module-level singleton, but the
 *    React component that subscribes to it can be reused so the loading
 *    flicker is skipped.
 *
 * What this island does NOT do:
 *  - It does not know about every page. New pages can opt into the SPA
 *    simply by mounting this island with a new `pageKey`.
 *  - It does not handle /docs/* routes — those use a different layout.
 *    Navs between the SPA and /docs/* lose the persisted state, which is
 *    acceptable because the AppBar is part of the main-app layout only.
 */
import React, { useState, useEffect, useMemo } from "react";
import { ThemeModeProvider } from "./ThemeModeProvider";
import { ResponsiveLayout } from "./ResponsiveLayout";
import LandingPage from "./LandingPage";
import DashboardPage from "./DashboardPage";
import AdminDashboardPage from "./AdminDashboardPage";
import CourtWatchesPage from "./CourtWatchesPage";
import PublicGamesPage from "./PublicGamesPage";
import EventPage from "./EventPage";
import NotFoundPage from "./NotFoundPage";

export type PageKey =
  | "landing"
  | "dashboard"
  | "admin"
  | "court-watches"
  | "public"
  | "event"
  | "not-found";

export interface PageProps {
  // The page component to render. If omitted, we resolve from pathname.
  pageKey?: PageKey;
  // Optional event id for /events/[id] routes. Resolved from pathname as
  // fallback so pages can mount the island with just `pageKey="event"`.
  eventId?: string;
}

/**
 * Resolve a pathname + the initial page key into the page component and
 * its props. Runs on every render — the cost is a single regex match per
 * page, dwarfed by the React render itself.
 */
function resolveRoute(pathname: string, initialKey?: PageKey) {
  if (initialKey) {
    switch (initialKey) {
      case "landing": return { key: "landing" as const, Component: LandingPage, props: {} as Record<string, unknown> };
      case "dashboard": return { key: "dashboard" as const, Component: DashboardPage, props: {} as Record<string, unknown> };
      case "admin": return { key: "admin" as const, Component: AdminDashboardPage, props: {} as Record<string, unknown> };
      case "court-watches": return { key: "court-watches" as const, Component: CourtWatchesPage, props: {} as Record<string, unknown> };
      case "public": return { key: "public" as const, Component: PublicGamesPage, props: {} as Record<string, unknown> };
      case "event": {
        const id = pathname.match(/^\/events\/([^/?#]+)/)?.[1];
        return { key: "event" as const, Component: EventPage, props: { eventId: id ?? "" } };
      }
      case "not-found": return { key: "not-found" as const, Component: NotFoundPage, props: {} as Record<string, unknown> };
    }
  }

  if (pathname === "/") return { key: "landing" as const, Component: LandingPage, props: {} as Record<string, unknown> };
  if (pathname === "/dashboard") return { key: "dashboard" as const, Component: DashboardPage, props: {} as Record<string, unknown> };
  if (pathname === "/admin") return { key: "admin" as const, Component: AdminDashboardPage, props: {} as Record<string, unknown> };
  if (pathname === "/court-watches") return { key: "court-watches" as const, Component: CourtWatchesPage, props: {} as Record<string, unknown> };
  if (pathname === "/public") return { key: "public" as const, Component: PublicGamesPage, props: {} as Record<string, unknown> };

  const eventMatch = pathname.match(/^\/events\/([^/?#]+)/);
  if (eventMatch) return { key: "event" as const, Component: EventPage, props: { eventId: eventMatch[1] } };

  return { key: "not-found" as const, Component: NotFoundPage, props: {} as Record<string, unknown> };
}

export default function SpaRoot(props: PageProps) {
  // Use the prop's pathname for SSR. On the client, listen for Astro
  // navigation events so the same React tree re-renders the new page.
  // The state initializer runs once on mount — `transition:persist` keeps
  // the state alive across navigations, so the initializer does not re-run.
  const [pathname, setPathname] = useState<string>(() => {
    if (typeof window === "undefined") return "/";
    return window.location.pathname;
  });

  useEffect(() => {
    const handler = () => setPathname(window.location.pathname);
    document.addEventListener("astro:after-swap", handler);
    return () => document.removeEventListener("astro:after-swap", handler);
  }, []);

  const { Component: PageComponent, props: pageProps, key } = useMemo(
    () => resolveRoute(pathname, props.pageKey),
    [pathname, props.pageKey],
  );

  // The `<div>` wrapper carries the page key for tests + future per-page CSS
  // hooks. `PageElement` is intentionally lowercase to keep the linter's
  // static-components rule happy (it assumes any capitalised identifier
  // in JSX is a component definition).
  const pageElement = useMemo(
    () => <PageComponent {...(pageProps as any)} />,
    [PageComponent, pageProps],
  );

  return (
    <ThemeModeProvider>
      <ResponsiveLayout>
        <div data-page-key={key} style={{ display: "contents" }}>
          {pageElement}
        </div>
      </ResponsiveLayout>
    </ThemeModeProvider>
  );
}
