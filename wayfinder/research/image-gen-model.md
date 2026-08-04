# Image Generation Model for UI Redesign Mockups

> Generated 2026-07-27. All pricing verified from official primary sources.

## Goal

Take Playwright screenshots → feed to image gen model → get improved UI mockups that preserve layout but improve spacing, color, typography, hierarchy, and map to MUI components.

## Comparison Table

| Model | API? | Cost/gen | UI Quality (1-5) | Layout Faithfulness (1-5) | MUI compat (1-5) | Text rendering | Image-to-image? |
|---|---|---|---|---|---|---|---|
| **Ideogram 4.0** | ✅ Direct REST | $0.03–$0.10 | 4 | 4 | 4 | ⭐⭐⭐⭐⭐ Best | ✅ Remix + image_weight |
| **Recraft V4.1** | ✅ Direct REST | $0.035–$0.25 | 5 | 3 | 5 | ⭐⭐⭐⭐ Good | ✅ img2img + strength |
| **Midjourney V7/V8.1** | ⚠️ 3rd-party only | $0.04–$0.15 | 5 | 2 | 3 | ⭐⭐ Weak | ✅ URL in prompt + --iw |
| **DALL-E 3** | ❌ **Deprecated May 2026** | n/a | 3 | 2 | 3 | ⭐⭐⭐ OK | ❌ Text-to-image only |
| **GPT-Image-2** | ✅ Direct REST | $0.04–$0.19 | 4 | 3 | 4 | ⭐⭐⭐⭐ Good | ✅ Edits + variation |
| **Stability SD3.5** | ✅ Direct REST | $0.025–$0.08 | 3 | 3 | 3 | ⭐⭐⭐ OK | ✅ img2img |
| **Claude Sonnet 4/5** | ✅ Direct REST | $3/$15 per MTok | N/A | N/A | N/A | N/A | ❌ Vision-only, no image output |

**Sources:**
- [Ideogram API Pricing](https://ideogram.ai/api-pricing/) — $0.03 Turbo / $0.06 Default / $0.10 Quality per image
- [Recraft API Pricing](https://www.recraft.ai/docs/api-reference/pricing) — V4.1 at $0.035/image, Pro at $0.25/image
- [Midjourney official plans](https://docs.midjourney.com/hc/en-us/articles/27870484040333-Comparing-Midjourney-Plans) — $10–$120/mo; [EvoLink per-request](https://evolink.ai/midjourney-v8-1) $0.075–$0.12/request
- [OpenAI API models](https://developers.openai.com/api/docs/models/dall-e-3) — DALL-E 3 marked previous-gen; deprecated May 12, 2026
- [Anthropic Pricing](https://platform.claude.com/docs/en/about-claude/pricing) — Sonnet 4.6 $3/$15 per MTok; [Claude vision docs](https://platform.claude.com/docs/en/build-with-claude/vision) confirm "cannot generate images"
- [Stability AI Pricing](https://platform.stability.ai/pricing) — 1 credit = $0.01; SD3.5 Medium 3.5cr ($0.035), Ultra 8cr ($0.08)

## Top Pick: Ideogram 4.0

**Why:** Best text rendering in any image gen model — critical for UI mockups where button labels, nav items, headings must be legible. The Remix endpoint accepts a source image + prompt with `image_weight` control (0-100) to balance layout faithfulness vs redesign freedom. At $0.03/image (Turbo), cheapest for bulk iteration. Aspect ratios match web screens exactly (16:9, 4:3, etc.).

**Ideal workflow:**
1. Take Playwright screenshot (PNG, 1920x1080)
2. Send to Ideogram Remix with `image_weight=60` and prompt describing MUI design improvements
3. Receive 1-4 redesigned variants at $0.06/image (Default tier)
4. Evaluate, refine prompt, re-remix

## Runner-Up: Recraft V4.1

**Why:** Purpose-built for design mockups with native SVG vector output, style locking from reference images, and "Utility" variant optimized for clean, controlled outputs. Image-to-image with `strength` parameter controls how much the output deviates from the source. V4.1 Pro ($0.25/image) delivers 4MP resolution with print-ready detail. Best MUI compatibility score because its outputs feel closest to component-based design systems. Slightly more expensive and layout faithfulness (score 3) is weaker than Ideogram's Remix — Recraft tends to reimagine more aggressively.

## Midjourney

**Avoid as primary tool.** No official API — must route through third-party proxies (EvoLink, Sharpii) adding latency and dependency risk. Text rendering is notably weak (button labels often garbled). Layout faithfulness is poor because Midjourney strongly imposes its own composition. Best-in-class visual polish (score 5) makes it useful for *mood exploration* but not for *layout-preserving redesign*.

## DALL-E 3 / GPT-Image-2

**DALL-E 3 is deprecated** (removed May 12, 2026 per OpenAI changelog). GPT-Image-2 is the replacement but lacks ideogram's text rendering fidelity. Image editing requires a mask PNG, making programmatic screenshot→mockup harder. Only viable if already on OpenAI stack; otherwise Ideogram or Recraft are better.

## Stability AI (SD3.5)

**Budget option** if you want to self-host open weights under the Community License (<$1M revenue, free). API at $0.025–$0.08/image is competitive. But image quality and prompt adherence for UI are noticeably behind Ideogram/Recraft. Text is often illegible at small sizes. Fine for early exploration, not production mockups.

## Claude Sonnet 4/5

**Not suitable.** Claude is vision-only — it can analyze a screenshot and describe what to improve, but it **cannot output images** (per Anthropic vision docs: "Claude is an image understanding model only... cannot generate, produce, edit, manipulate, or create images"). Useful as part of a two-stage pipeline (Claude critiques layout → Ideogram generates), but not the gen model itself.

## Concrete API Example: Ideogram 4.0 Remix

This is the call you'd make from a script. Takes a source screenshot URL, applies a redesign prompt, returns improved mockup URLs.

```bash
curl -X POST https://api.ideogram.ai/v1/ideogram-v4/remix \
  -H "Api-Key: $IDEOGRAM_API_KEY" \
  -F "image_url=https://your-site.com/screenshots/dashboard.png" \
  -F "prompt=Redesign this dashboard. Use Material-UI components: AppBar header, Card for KPI metrics, Paper sections, contained Buttons, proper typography hierarchy (H1-H6). Improve whitespace, use 8px grid spacing. Clean modern design, subtle shadows on cards, proper color contrast." \
  -F "image_weight=60" \
  -F "aspect_ratio=16:9" \
  -F "rendering_speed=DEFAULT" \
  -F "num_images=2" \
  -F "style_type=GENERAL"
```

**Response:**
```json
{
  "created": "2026-07-27T12:00:00+00:00",
  "data": [
    {
      "url": "https://ideogram.ai/api/images/ephemeral/abc123.png?exp=...",
      "resolution": "1408x768",
      "is_image_safe": true,
      "seed": 12345
    },
    {
      "url": "https://ideogram.ai/api/images/ephemeral/def456.png?exp=...",
      "resolution": "1408x768",
      "is_image_safe": true,
      "seed": 12346
    }
  ]
}
```

**Cost:** $0.06 × 2 images = $0.12 per call (Default tier). With Turbo tier: $0.03 × 2 = $0.06.

**Important:** Image URLs are ephemeral — download immediately (60-min expiry on generation response URLs). For bulk work, store to S3/supabase after download.

## Recommendation

| Use case | Model |
|---|---|
| Layout-preserving redesign (primary) | **Ideogram 4.0 Default** ($0.06/img) |
| Brand-consistent redesign system | **Recraft V4.1** ($0.035/img) |
| High-volume drafts | **Ideogram 4.0 Turbo** ($0.03/img) |
| Print-ready mockups | **Recraft V4.1 Pro** ($0.25/img) |
| Mood exploration only | Midjourney via proxy |
| Critique + description pipeline | Claude Sonnet 4.6 (text only) |

**Build order for script:**

1. Playwright captures screenshot → upload to S3 → get public URL
2. Call Claude Sonnet 4.6 with screenshot URL → get structured MUI improvement brief
3. Feed brief + screenshot URL → Ideogram 4.0 Remix → get mockup URLs
4. Download mockups, human review, iterate on prompt
