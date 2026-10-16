import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import eslintReact from "@eslint-react/eslint-plugin";

export default tseslint.config(
  // ── Ignores ─────────────────────────────────────────────────────────────────
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      ".astro/**",
      ".stryker-tmp/**",
      ".worktrees/**",
      "coverage/**",
      "k6/**",
      "e2e/**",
      "scripts/**",
      "*.config.*",
    ],
  },

  // ── Base JS recommended ─────────────────────────────────────────────────────
  js.configs.recommended,

  // The Play listing gates run on bare Node — the publish job that calls them
  // has no bundler and no toolchain — so they get Node globals rather than the
  // browser ones src/ gets. They are linted explicitly (`pnpm lint`) because they
  // fail releases, which is a different bar from the other scripts.
  {
    files: ["scripts/check-play-listing.mjs", "scripts/check-play-screenshots.mjs"],
    languageOptions: {
      globals: { console: "readonly", process: "readonly", Buffer: "readonly" },
    },
  },

  // ── TypeScript recommended ──────────────────────────────────────────────────
  ...tseslint.configs.recommended,

  // ── React (eslint-react) ────────────────────────────────────────────────────
  {
    ...eslintReact.configs["recommended-typescript"],
    files: ["src/**/*.tsx"],
  },
  {
    ...eslintReact.configs["web-api"],
    files: ["src/**/*.tsx"],
  },

  // ── React Hooks ─────────────────────────────────────────────────────────────
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Downgrade to warning — common pattern in the codebase, not a bug
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/refs": "warn",
    },
  },

  // ── Custom rules for all source files ───────────────────────────────────────
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      // ── Complexity & responsibility ───────────────────────────────────────
      // Flag functions/components that are getting too large
      "max-lines-per-function": ["warn", {
        max: 1000,
        skipBlankLines: true,
        skipComments: true,
      }],
      // Cyclomatic complexity — too many branches = hard to maintain
      "complexity": ["warn", 100],
      // Limit nesting depth — deeply nested code is hard to follow
      "max-depth": ["warn", 6],
      // Too many parameters = the function does too much
      "max-params": ["warn", 10],

      // ── Code quality ──────────────────────────────────────────────────────
      // Prefer const over let when variable is never reassigned
      "prefer-const": "error",
      // No unused variables (allow underscore prefix for intentional ignores)
      "@typescript-eslint/no-unused-vars": ["error", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
      }],
      // Disallow explicit `any` — use proper types
      "@typescript-eslint/no-explicit-any": "warn",
      // No empty catch blocks without a comment
      "no-empty": ["error", { allowEmptyCatch: true }],
      // Require === instead of ==
      "eqeqeq": ["error", "always"],
      // No var — use let/const
      "no-var": "error",

      // ── TypeScript specific ───────────────────────────────────────────────
      // Allow non-null assertions sparingly (warn, not error)
      "@typescript-eslint/no-non-null-assertion": "warn",
      // Consistent type imports
      "@typescript-eslint/consistent-type-imports": ["warn", {
        prefer: "type-imports",
        fixStyle: "inline-type-imports",
      }],
    },
  },

  // ── React component-specific rules ──────────────────────────────────────────
  {
    files: ["src/**/*.tsx"],
    rules: {
      // Prevent defining components inside other components (causes remounts)
      "@eslint-react/no-nested-component-definitions": "error",
      // Prevent unstable default props
      "@eslint-react/no-unstable-default-props": "warn",
      // Ensure key is present in iterators
      "@eslint-react/no-missing-key": "error",
      // No array index as key
      "@eslint-react/no-array-index-key": "warn",
      // Prevent direct mutation of state
      "@eslint-react/no-direct-mutation-state": "error",
      // No duplicate keys in JSX
      "@eslint-react/no-duplicate-key": "error",
      // Detect leaked event listeners, intervals, timeouts
      "@eslint-react/web-api-no-leaked-event-listener": "warn",
      "@eslint-react/web-api-no-leaked-interval": "warn",
      "@eslint-react/web-api-no-leaked-timeout": "warn",
      // React Compiler hints — these trigger only when React Compiler is enabled.
      // The codebase doesn't use the React Compiler yet, and these warnings are
      // noise that block CI. Disabled until the compiler is adopted.
      "@eslint-react/unsupported-syntax": "off",
    },
  },

  // ── One money format ────────────────────────────────────────────────────────
  // Money renders through `src/lib/money.ts` and nowhere else. Three consecutive
  // review rounds found a private formatter no test covered:
  // `Intl.NumberFormat({ style: "currency" })` in two components, a hand-rolled
  // symbol map in a third, `toFixed(2)` in a push body and a cron notification,
  // and a `formatMoney` call that dropped its currency. The rule is mechanical,
  // so it is a check here rather than a line in CODING_STANDARDS.
  //
  // Pinned by src/test/money-guardrail.test.ts, which fails if this block is
  // deleted or de-scoped. `toFixed` is matched at precision 2 only: rating maths
  // uses 3, percentages 0 and coordinates 6, and those are not money.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/lib/money.ts", "src/test/**"],
    rules: {
      "no-restricted-syntax": ["error",
        {
          selector: "NewExpression[callee.object.name='Intl'][callee.property.name='NumberFormat']",
          message:
            "One money format: render money with formatMoney from src/lib/money.ts, not Intl.NumberFormat.",
        },
        {
          selector: "CallExpression[callee.property.name='toFixed'][arguments.0.value=2]",
          message:
            "One money format: render money with formatMoney from src/lib/money.ts, not toFixed(2). A wire format that is not a display takes an eslint-disable with the reason.",
        },
        {
          selector: "Literal[value=/[€£]/]",
          message:
            "One money format: the currency symbol lives in src/lib/money.ts. Render money with formatMoney.",
        },
        {
          selector: "TemplateElement[value.raw=/[€£]/]",
          message:
            "One money format: the currency symbol lives in src/lib/money.ts. Render money with formatMoney.",
        },
      ],
    },
  },

  // ── Test files — relax some rules ───────────────────────────────────────────
  {
    files: ["src/test/**/*.{ts,tsx}", "**/*.test.{ts,tsx}"],
    rules: {
      "max-lines-per-function": "off",
      "complexity": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-require-imports": "off",
      "max-params": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
);
