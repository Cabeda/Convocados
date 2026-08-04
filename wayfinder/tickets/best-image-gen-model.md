# Research: Best image gen model for UI mockup generation

**Type:** research (AFK)
**Labels:** wayfinder:research
**Blocked by:** none

## Question

Which image generation model produces the most faithful and useful UI redesign mockups when given a screenshot of the current page? Evaluate candidates on:

1. **Fidelity to source layout** — does it preserve the page structure (nav bar, content areas, footer) or hallucinate new layouts?
2. **Design quality** — does it produce genuinely improved visual designs (better spacing, color harmony, typography, hierarchy)?
3. **MUI compatibility** — does the generated design use patterns that map cleanly to MUI components (cards, buttons, app bars, drawers)?
4. **API availability** — can we call it programmatically from a script? Cost per generation?

Candidates to evaluate: Midjourney (via API), DALL-E 3, Claude (Sonnet vision + image gen), Ideogram, Stability AI (SDXL/SD3), Recraft.

Deliverable: a recommendation table with scores per candidate, top pick, and rationale.

## Resolution

Research complete — see [wayfinder/research/image-gen-model.md](../research/image-gen-model.md).

**Verdict:** Ideogram 4.0 is top pick (best text rendering for UI, Remix endpoint with image_weight control, $0.06/image). Recraft V4.1 runner-up. DALL-E 3 deprecated May 2026. Claude can't output images. Midjourney has no official API.

Close this ticket.
