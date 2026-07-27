# Map: AI-Powered UI Review Pipeline

## Destination

Working prototype of an AI-powered UI review pipeline. Takes screenshots of all pages, feeds them to an image gen model for mockup improvements, then applies those improvements as MUI theme + targeted component changes. Proved by transforming **at least one page** end-to-end.

## Notes

- Stack: Astro 7 + React 19 + MUI 9 + Playwright + SQLite
- Playwright already configured (12 existing e2e specs, `playwright.config.ts`, `global-setup.ts`)
- Seed script: `prisma/seed.ts` (adds 100 events + demo user)
- All UI is MUI components with `sx` prop + `createTheme` in `ThemeModeProvider.tsx`
- Pipeline is interactive/human-in-loop per step, not one-shot
- Abstract design tokens first for token efficiency
- Research image gen model before committing to one
- Conventions: TDD, conventional commits, PRs from branches

## Decisions so far

- [Best image gen model for UI mockup generation](tickets/best-image-gen-model.md) — Ideogram 4.0 (top pick, $0.06/img, Remix endpoint for img2img). Recraft V4.1 runner-up. DALL-E 3 deprecated. Claude can't output images. [Full comparison](research/image-gen-model.md).

## Not yet specified

- **Mockup-to-code fidelity validation**: once code changes are applied, how to tell if they match the mockup? Manual review? Screenshot diff?
- **State coverage per page**: each page has multiple states (empty, loading, error, toasts, modals) — which states do we screenshot? A decision for after the first page works.
- **Multi-page scaling**: once one page is transformed, how to expand to all pages efficiently. Likely blocked by the token abstraction work paying off.
- **Human review workflow**: how are generated mockups presented to the user for selection? A gallery page? Drop them in a folder?

## Out of scope

- **Penpot migration** — overkill for a MUI-based project. MUI already is the design system.
- **One-shot fully automated pipeline** — ruled out during charting: user wants human-in-loop at each gate.
- **Integration with CI/CD** — not part of the prototype scope. If concept proves, that's a downstream effort.
