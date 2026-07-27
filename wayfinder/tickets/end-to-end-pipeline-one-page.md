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

This ticket is blocked until the three preceding tickets resolve — need the model choice, the screenshot tool, and the token abstraction strategy.

Deliverable: the transformed page, the mockup image that informed it, and a summary of what worked and what didn't in the pipeline.
