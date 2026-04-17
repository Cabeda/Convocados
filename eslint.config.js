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
      "coverage/**",
      "k6/**",
      "e2e/**",
      "scripts/**",
      "*.config.*",
    ],
  },

  // ── Base JS recommended ─────────────────────────────────────────────────────
  js.configs.recommended,

  // ── TypeScript recommended ──────────────────────────────────────────────────
  ...tseslint.configs.recommended,

  // ── React (eslint-react) ────────────────────────────────────────────────────
  {
    ...eslintReact.configs["recommended-typescript"],
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
        max: 200,
        skipBlankLines: true,
        skipComments: true,
      }],
      // Cyclomatic complexity — too many branches = hard to maintain
      "complexity": ["warn", 15],
      // Limit nesting depth — deeply nested code is hard to follow
      "max-depth": ["warn", 4],
      // Too many parameters = the function does too much
      "max-params": ["warn", 5],

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
      "@eslint-react/web-api/no-leaked-event-listener": "warn",
      "@eslint-react/web-api/no-leaked-interval": "warn",
      "@eslint-react/web-api/no-leaked-timeout": "warn",
      // React Compiler hints — warn only (not bugs, optimization suggestions)
      "@eslint-react/unsupported-syntax": "warn",
      "@eslint-react/component-hook-factories": "warn",
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
    },
  },
);
