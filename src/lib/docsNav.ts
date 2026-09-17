/**
 * Single source of truth for the docs navigation.
 *
 * Consumed by `DocsLayout.astro` (sidebar + prev/next) and by the generated
 * `/llms.txt` index. Keep every docs page listed here so agents and humans
 * see the same map; `src/test/llms.test.ts` fails if an entry has no page.
 */

export interface DocsNavItem {
  href: string;
  label: string;
}

export interface DocsNavSection {
  title: string;
  items: DocsNavItem[];
}

export interface DocsNavPage extends DocsNavItem {
  section: string;
}

export const docsNav: DocsNavSection[] = [
  {
    title: "Getting Started",
    items: [
      { href: "/docs", label: "Overview" },
      { href: "/docs/quickstart", label: "Quickstart" },
      { href: "/docs/tutorial", label: "Tutorial" },
      { href: "/docs/mobile", label: "Mobile Apps" },
    ],
  },
  {
    title: "Features",
    items: [
      { href: "/docs/features/events", label: "Events" },
      { href: "/docs/features/players", label: "Players & Bench" },
      { href: "/docs/features/teams", label: "Teams" },
      { href: "/docs/features/recurrence", label: "Recurring Games" },
      { href: "/docs/features/notifications", label: "Notifications" },
      { href: "/docs/features/history", label: "History & Scores" },
      { href: "/docs/features/court-finder", label: "Court Finder" },
    ],
  },
  {
    title: "API Reference",
    items: [
      { href: "/docs/api", label: "Overview" },
      { href: "/docs/api/events", label: "Events" },
      { href: "/docs/api/players", label: "Players" },
      { href: "/docs/api/teams", label: "Teams" },
      { href: "/docs/api/webhooks", label: "Webhooks" },
      { href: "/docs/api/push", label: "Push Notifications" },
      { href: "/docs/api/history", label: "History" },
      { href: "/docs/api-reference", label: "Full Reference" },
    ],
  },
  {
    title: "Guides",
    items: [
      { href: "/docs/guides/webhook-openclaw", label: "Webhook + OpenClaw" },
      { href: "/docs/guides/self-hosting", label: "Self-Hosting" },
      { href: "/docs/guides/contributing", label: "Contributing" },
      { href: "/docs/privacy", label: "Privacy" },
      { href: "/docs/delete-account", label: "Delete Account" },
    ],
  },
];

/** Flattened pages in sidebar order, each tagged with its section title. */
export const docsPages: DocsNavPage[] = docsNav.flatMap((section) =>
  section.items.map((item) => ({ ...item, section: section.title })),
);
