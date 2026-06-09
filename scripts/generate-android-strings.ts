/**
 * Generate Android strings.xml files from the web i18n source of truth.
 * Only emits keys listed in shared-i18n-keys.json.
 *
 * Usage: npx tsx scripts/generate-android-strings.ts
 */
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..");
const KEYS: string[] = JSON.parse(
  readFileSync(resolve(ROOT, "scripts/shared-i18n-keys.json"), "utf-8"),
);

const LOCALES: Record<string, string> = {
  en: "values",
  pt: "values-pt",
  es: "values-es",
  fr: "values-fr",
  de: "values-de",
  it: "values-it",
};

function loadLocale(locale: string): Record<string, string> {
  const filePath = resolve(ROOT, `src/lib/i18n/${locale}.ts`);
  const source = readFileSync(filePath, "utf-8");
  // Extract key-value pairs from the TS object literal
  const entries: Record<string, string> = {};
  const regex = /^\s+(\w+):\s*"((?:[^"\\]|\\.)*)"/gm;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(source)) !== null) {
    entries[match[1]] = match[2].replace(/\\"/g, '"');
  }
  return entries;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"');
}

function camelToSnake(s: string): string {
  return s.replace(/([A-Z])/g, "_$1").toLowerCase();
}

function generateStringsXml(locale: string): string {
  const translations = loadLocale(locale);
  const lines = ['<?xml version="1.0" encoding="utf-8"?>', "<resources>"];

  for (const key of KEYS) {
    const value = translations[key];
    if (value) {
      lines.push(`    <string name="${camelToSnake(key)}">${escapeXml(value)}</string>`);
    } else {
      // Fallback to English if key missing in locale
      const en = loadLocale("en");
      const fallback = en[key] || `TODO:${key}`;
      lines.push(
        `    <!-- TODO: translate --><string name="${camelToSnake(key)}">${escapeXml(fallback)}</string>`,
      );
    }
  }

  lines.push("</resources>", "");
  return lines.join("\n");
}

// Generate for each locale
for (const [locale, dir] of Object.entries(LOCALES)) {
  const outDir = resolve(ROOT, `android-app/app/src/main/res/${dir}`);
  mkdirSync(outDir, { recursive: true });
  const xml = generateStringsXml(locale);
  const outPath = resolve(outDir, "strings.xml");
  writeFileSync(outPath, xml);
  console.log(`✓ Generated ${dir}/strings.xml (${KEYS.length} keys)`);
}
