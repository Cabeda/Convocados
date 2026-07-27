# Prototype: Wire end-to-end pipeline for one page

**Type:** prototype (HITL)
**Labels:** wayfinder:prototype
**Blocked by:** Best image gen model for UI mockup generation, Playwright screenshot pipeline for all routes, MUI design token extraction strategy

## Question

Can we wire the full pipeline end-to-end for a single page (likely the landing page), proving the concept?

Steps:

1. **Screenshot** — use the screenshot pipeline to capture the current landing page.
2. **Critique + mockup** — feed the screenshot to the chosen image gen model, producing before/after mockups.
3. **Extract design deltas** — from the mockup, derive the specific MUI theme token changes and component-level edits needed.
4. **Apply changes** — refactor the token config and landing page component to match.
5. **Verify** — screenshot the updated page and compare to the mockup (human reviews).

...

## Resolution (reframed)

Pipeline split into groundwork + human-driven loop:

**Groundwork done (this effort):**
- Screenshot pipeline producing all 16 pages (`npm run screenshots`)
- Design tokens extracted for AI-editable theming (`src/theme/tokens.ts`)

**Remains (future session, when user provides mockup):**
- Apply token/component edits based on mockup image
- One-page transformation as proof of concept

This map exists so the pipeline is ready when mockups arrive. Closing as "groundwork complete, awaiting mockups."

Close this ticket.
