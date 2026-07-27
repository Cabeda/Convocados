# Grilling: MUI design token extraction strategy

**Type:** grilling (HITL)
**Labels:** wayfinder:grilling
**Blocked by:** none

## Question

How should the current MUI theme be refactored to expose clean design tokens that an AI can modify without touching individual component files?

Current state: theme lives inline in `ThemeModeProvider.tsx` via `createTheme()`. Components use `sx` prop with hardcoded values (e.g., `borderRadius: 2`, `p: 2`) rather than theme tokens.

Decisions to make:

1. **Token format** — extract to a standalone `theme/` config file (e.g., `theme/tokens.ts` exporting color palette, spacing scale, typography, shape, shadows)? Or keep in `createTheme()` but make it more structured?
2. **What gets extracted** — just the palette? Or spacing, typography, breakpoints, z-index, transitions?
3. **Token adoption** — how to migrate components from hardcoded `sx` values to theme token references without rewriting everything at once?
4. **AI interface** — what does the AI need to know to modify the tokens? A schema file? A JSON config?
5. **Dark mode** — the current theme supports dark/light switching. How do tokens compose with palette modes?

Deliverable: a concrete plan (not code, a decision) for how to structure the token abstraction so an AI agent can modify it safely and the changes propagate to all components.
