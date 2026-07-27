# Map: AI-Powered UI Review Pipeline

## Destination

Base pipeline ready: automated screenshots of all pages, design tokens extracted to a clean AI-editable layer. User provides mockup images, agent applies token + component changes.

## Notes

- Stack: Astro 7 + React 19 + MUI 9 + Playwright + SQLite
- All UI is MUI components with `sx` prop + `createTheme` backed by `src/theme/tokens.ts`
- Conventions: TDD, conventional commits, PRs from branches

## Decisions so far

- [Best image gen model for UI mockup generation](tickets/best-image-gen-model.md) — Ideogram 4.0 (top pick). [Full comparison](research/image-gen-model.md).
- [Playwright screenshot pipeline for all routes](tickets/playwright-screenshot-pipeline.md) — `npm run screenshots` produces 16 screenshots in `screenshots/`. Handles auth via demo user. Discovers event IDs from API. [Script](scripts/screenshots.ts).
- [MUI design token extraction strategy](tickets/mui-design-token-extraction.md) — Tokens in `src/theme/tokens.ts`, builder in `src/theme/index.ts`, `ThemeModeProvider.tsx` refactored to 3-line call. [Tests](src/test/theme-tokens.test.ts) verify values match original.

## Not yet specified

- **Multi-page scaling**: one landing page flows first, then expand.
- **State coverage per page**: empty/loading/error states for screenshots.
- **Mockup-to-code fidelity check**: visual diff after applying changes.

## Out of scope

- **Penpot migration** — overkill for MUI project.
- **One-shot fully automated pipeline** — human-in-loop per gate.
- **Ideogram/mockup-gen integration** — user provides mockups manually.
