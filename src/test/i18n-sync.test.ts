/**
 * i18n Sync Test
 *
 * Validates that every key in shared-i18n-keys.json exists in all web locale files.
 * This ensures the Android string generator won't produce TODO fallbacks.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "../..");
const KEYS: string[] = JSON.parse(
  readFileSync(resolve(ROOT, "scripts/shared-i18n-keys.json"), "utf-8"),
);
const LOCALES = ["en", "pt", "es", "fr", "de", "it"];

function extractKeys(locale: string): Set<string> {
  const source = readFileSync(resolve(ROOT, `src/lib/i18n/${locale}.ts`), "utf-8");
  const keys = new Set<string>();
  const regex = /^\s+(\w+):\s*"/gm;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(source)) !== null) {
    keys.add(match[1]);
  }
  return keys;
}

describe("i18n Sync: shared keys exist in all locales", () => {
  for (const locale of LOCALES) {
    describe(`Locale: ${locale}`, () => {
      const localeKeys = extractKeys(locale);

      for (const key of KEYS) {
        it(`has key "${key}"`, () => {
          expect(
            localeKeys.has(key),
            `Key "${key}" is in shared-i18n-keys.json but missing from src/lib/i18n/${locale}.ts`,
          ).toBe(true);
        });
      }
    });
  }
});
