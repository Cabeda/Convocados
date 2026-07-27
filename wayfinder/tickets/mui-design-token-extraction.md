# Grilling: MUI design token extraction strategy

**Type:** grilling (HITL)
**Labels:** wayfinder:grilling
**Blocked by:** none

## Question

How should the current MUI theme be refactored to expose clean design tokens that an AI can modify without touching individual component files?

...

## Resolution

Implemented:
- `src/theme/tokens.ts` — typed `DesignTokens` with palette (light + dark), typography, shape, and component tokens
- `src/theme/index.ts` — `buildThemeOptions(mode)` constructs MUI `ThemeOptions` from tokens
- `ThemeModeProvider.tsx` — refactored to single `createTheme(buildThemeOptions(mode))` call
- `src/test/theme-tokens.test.ts` — 7 tests verifying light/dark palette and component overrides match original values

Result: AI agent reads `tokens.ts`, edits token values, and theme propagates globally. No need for AI to touch component files for most design changes. TypeScript types serve as the AI-facing schema.

Close this ticket.
