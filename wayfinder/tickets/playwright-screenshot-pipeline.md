# Prototype: Playwright screenshot pipeline for all routes

**Type:** prototype (HITL)
**Labels:** wayfinder:prototype
**Blocked by:** none

## Question

What does the Playwright script look like that iterates all routes, handles auth, seeds data, and produces organized screenshot output?

Must cover:

1. **Route inventory** — list of all pages with their URL patterns. Dynamic routes (`/events/[id]`, `/users/[id]`) need concrete IDs from seed data.
2. **Auth session** — how to get a valid session cookie for auth-gated pages (dashboard, admin, profile, settings, etc.). Existing seed script creates a demo user.
3. **Seed data** — does the existing `prisma/seed.ts` create enough data for all dynamic routes? What's missing? (Run it, check.)
4. **Screenshot output** — directory structure, naming convention, viewport sizes (mobile vs desktop?).
5. **Script ergonomics** — single `npm run` command? Config file?

Deliverable: the Playwright script (or config) plus seed data adaptations, producing a `screenshots/` directory with one image per page.
