# Cross-device Material 3 Expressive foundation

**Status:** Accepted

## Context

The Android phone and Wear modules already use Material 3, but they expose unrelated expressive token models and diverge in how semantic states, motion, adaptive layouts, and fixture coverage are represented. The phone has a Convocados green palette, optional Android dynamic color, and compact/medium/expanded width helpers. Wear has an OLED-safe palette, round-device ergonomics, haptics, ambient behavior, and expressive motion. Neither module has a shared semantic contract, a deterministic state matrix, or a large-window list-detail scene.

Issue #849 asks for a cross-device Material 3 Expressive revamp while preserving product navigation, event lifecycle semantics, Wear-specific interaction, and platform parity. The implementation is intentionally one PR, but it must remain organized around a shared foundation rather than a wholesale domain rewrite.

## Decisions

### 1. Deliver the complete issue in one PR

The PR covers the shared expressive foundation, phone and Wear mappings, representative component/screen updates, adaptive Games-to-Event Detail behavior, deterministic fixtures and screenshot outputs, accessibility checks, reduced-motion behavior, and restoration tests. It does not change server/API/auth/domain lifecycle semantics.

### 2. Share semantic contracts, not rendered values

Add a new `:design-system` Android module containing platform-neutral expressive role names and token contracts. The phone and Wear modules map the contract to their own `ColorScheme`, typography, shapes, density, and interaction scales. Phone values may use brand-preserving dynamic color; Wear values remain OLED-safe and round-device-specific.

The shared contract is the vocabulary and state model. It is not a single palette or a requirement that phone and watch surfaces look identical.

### 3. Preserve Convocados identity while allowing dynamic color

Phone dynamic color remains an explicit user preference on Android 12+. Dynamic color may adapt neutral/background roles, but Convocados brand roles and semantic roles—success, warning, live, offline, payment, and error—remain stable and contrast-checked. Fixed light/dark schemes remain the fallback and Wear does not consume phone dynamic color.

### 4. Use expressive motion cross-device, respecting system reduction

Phone and Wear use expressive motion by default where the platform supports it. The system animator/reduced-motion setting takes precedence: animations simplify or become immediate when motion reduction is requested. No new app-only motion preference is required for this foundation.

### 5. Make Games-to-Event Detail the first adaptive scene

On medium/expanded phone windows, the primary Games workflow becomes a list-detail/supporting-pane relationship between the Games list and Event Detail. Compact phone and Wear remain full-screen flows. Selection, deep links, back behavior, process restoration, and empty/loading/error states must be deterministic and tested. The three phone top-level destinations remain Games, Stats, and Profile.

### 6. Preserve Wear-specific interaction

Wear receives the shared role contract plus representative updates to Games, live Score, and Quick Game. The implementation preserves round-safe-area layout, large touch targets, rotary input, haptics, ambient mode, offline/stale/sync-queued/token-expired/retry states, and the OLED palette. Wear does not adopt phone navigation density or phone pane layouts.

### 7. Require a full deterministic fixture matrix

The release fixture matrix covers populated, empty, loading, error, offline/stale, live/urgent, and payment states across phone compact, tablet, foldable, and round Wear targets. Goldens pin dimensions, system bars, locale, font scale, dynamic-color seed, ambient mode, and safe-area assumptions. Authentication, network, credentials, and production data are mocked or bypassed in fixtures.

### 8. Define hard quality gates

The PR must include:

- semantic token and theme tests;
- screenshot goldens for the fixture matrix;
- accessibility semantics and minimum touch-target checks;
- reduced-motion coverage;
- adaptive scene selection, deep-link, back-stack, and restoration tests;
- no clipping or unsafe round-screen content;
- no changes to event lifecycle, scoring, payment, auth, offline-sync, or notification semantics.

Performance profiling remains a validation concern, but a full benchmark lab is not a prerequisite for this PR.

### 8. Keep the Wear Google Sign-In compatibility exception explicit

The shared catalog tracks Play Services Auth 22.0.0 for the requested library update. Wear remains on the pinned 21.3.0 legacy artifact because the standalone watch flow still uses `GoogleSignIn`/`GoogleSignInClient`, which Auth 22 removed, and the documented Credential Manager path is not supported for this Wear flow. The exception is isolated to `:wear`; phone authentication uses Credential Manager.

## Alternatives rejected

- **One shared rendered palette:** rejected because OLED Wear, round-device density, and phone dynamic color have different constraints.
- **Separate token APIs with no conformance contract:** rejected because semantic drift would continue between modules.
- **Wear-only expressive motion:** rejected because expressive interaction is part of the cross-device language.
- **Wholesale Navigation 3 migration before a vertical workflow:** rejected in favor of proving the Games-to-Event Detail scene first while preserving compact and Wear navigation.
- **Populated screenshots only:** rejected because offline, payment, live, loading, and error states are core product states and are easy to regress visually.
