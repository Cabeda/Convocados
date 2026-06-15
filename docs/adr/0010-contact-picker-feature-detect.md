# Contact Picker: feature-detect with no fallback

The web add-player UI shows a `Contacts` icon only when `navigator.contacts` and `navigator.contacts.select` are available (Chromium-based browsers); it is hidden on Safari and Firefox. We considered three alternatives: hide the icon (chosen), render it with a snackbar explaining the lack of support, or always show it and let `select()` throw. Hiding is the safest — iOS Safari and Firefox are unsupported, and a tappable icon that explains "your browser can't do this" reads as a bug. A future reader should not "fix" the silent Safari behaviour by adding a snackbar or polyfill; the design choice is intentional.

## Status

Accepted, 2026-06-12.

## Considered options

1. **Hide the icon when unsupported** (chosen). Clean, conservative, matches the API's deliberate cross-browser absence.
2. **Always show + snackbar on tap.** Educational, but a button that opens a "your browser can't" message reads as a bug and adds layout noise.
3. **Always show + fall through to email on tap.** Two paths, no discoverability gain over option 1.

## Consequences

- iOS Safari and Firefox users see only the typed-email path. They will be the majority of mobile users — most mobile-web traffic is Safari. This is an acceptable trade-off because the typed-email path is complete and the contact picker is a quality-of-life add-on, not a primary path.
- A future cross-browser shim (e.g. a polyfill via file upload or OAuth contact import) would slot in at the same `contactPickerSupported` predicate without changing call sites.
- The Android app continues to use the platform `ACTION_PICK` intent; this ADR does not affect it.
