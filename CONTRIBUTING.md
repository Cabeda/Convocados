# Contributing to Convocados

Thanks for contributing. This guide is the short version; the full development
workflow lives in [AGENTS.md](./AGENTS.md).

## 1. Sign the CLA

First-time contributors must sign the [Contributor License Agreement](./CLA.md).
The CLA assistant bot prompts you automatically on your first pull request —
comment **"I have read the CLA Document and I hereby sign the CLA"** and your
signature is recorded in the repository. Maintainer accounts are pre-allowed.

Without a signed CLA your pull request cannot be merged: the Project ships
under FSL-1.1-ALv2 and needs an explicit grant to relicense or sell commercial
licenses over contributed code.

## 2. Workflow

1. Pick or open an issue (this repo tracks work in `dex`; see AGENTS.md).
2. Branch from `main`: `feat/…`, `fix/…`, `refactor/…`.
3. **Test-driven development**: write a failing test first, implement the
   minimum to pass, then refactor.
4. All changes need tests — new features get coverage, bugs get regression
   tests.
5. Never push to `main`: open a pull request and wait for CI.

## 3. Quality gates

The pre-push hook runs automatically and blocks pushes that fail:

```bash
npm run lint -- --max-warnings 259
npm run typecheck
npm run test -- --coverage   # thresholds only ever move up
```

Android changes additionally need the `:app` unit suite green
(`./gradlew :app:testDebugUnitTest`).

Coverage thresholds in `vitest.config.ts` are a floor: never lower them, never
skip or weaken tests to make the gate pass.

## 4. Style

- Conventional commits: `feat:`, `fix:`, `test:`, `docs:`, …
- TypeScript strict — no `any`; MUI components; i18n keys added to **all six**
  locales (`en`, `pt`, `es`, `fr`, `de`, `it`).
- Platform parity: a user-facing feature ships on web and Android (and Wear
  where the affordance exists) in the same PR or a linked follow-up.

## 5. Trademark

Code contributions do not grant rights to the Convocados name or logo — see
[TRADEMARK.md](./TRADEMARK.md).

## Good first issues

Labeled [`good first issue`](https://github.com/Cabeda/Convocados/labels/good%20first%20issue).
