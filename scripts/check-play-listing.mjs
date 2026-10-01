#!/usr/bin/env node
/**
 * Play store listing gate.
 *
 * Google Play rejected the Wear app under the Wear App Quality Guidelines because
 * the listing did not mention the quick-game tile, though the tile had shipped for
 * months. Nothing in the repo recorded the listing text, so nothing noticed. The
 * text is committed at `android-app/store-listing/<lang>/` and this is the gate that
 * keeps it honest — see ADR 0049 and `android-app/PLAY_STORE_PUBLISHING.md`.
 *
 * Two classes of failure:
 *
 * 1. **Incomplete text.** Every language must carry all three fields, none empty,
 *    each within Play's limit. Play replaces the whole listing resource per
 *    language, so a missing field is not "unchanged" — it is cleared.
 * 2. **An undocumented Wear surface.** The obligations below are *derived from the
 *    wear module* — its manifest and its Kotlin sources — not kept in a checklist.
 *    A surface that exists in code obliges a line in the description, so the next
 *    tile, complication or watch face cannot ship undocumented.
 *
 * This is the only implementation of these rules. `pnpm check:play-listing` runs
 * it in GATE 1 and on every release; `src/test/play-listing.test.ts` exercises the
 * failing paths through this same module, so the gate cannot decay into a no-op
 * unnoticed.
 *
 * Usage: node scripts/check-play-listing.mjs
 * Exit code 1 with one message per problem.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** Play's per-field character limits (Android Publisher `Listings` resource). */
const FIELDS = [
  { file: "title.txt", limit: 30 },
  { file: "short_description.txt", limit: 80 },
  { file: "full_description.txt", limit: 4000 },
];

/**
 * Wear surfaces Play expects the listing to describe. `detect` reads the module
 * rather than the listing, so adding a surface to the app adds the obligation
 * without touching this file.
 *
 * Each entry pairs a keyword the description must contain with a detector over
 * (manifest, kotlin sources). The detectors favour over-triggering: a false
 * positive costs a sentence of copy, a false negative is the rejection this
 * script exists to prevent.
 */
const WEAR_SURFACES = [
  {
    keyword: "tile",
    label: "a Wear tile (BIND_TILE_PROVIDER / TileService)",
    detect: ({ manifest, kotlin }) =>
      /bind_tile_provider/i.test(manifest) || /:\s*TileService\s*\(/.test(kotlin),
  },
  {
    keyword: "ongoing",
    label: "a live-score ongoing activity (OngoingActivity)",
    detect: ({ kotlin }) => /OngoingActivity\b/.test(kotlin),
  },
];

function kotlinSources(dir) {
  const found = [];
  if (!existsSync(dir)) return found;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(kotlinSources(path));
    else if (entry.name.endsWith(".kt")) found.push(readFileSync(path, "utf8"));
  }
  return found.join("\n");
}

/**
 * @param {{listingDir: string, wearDir: string}} options
 * @returns {string[]} one message per problem; empty means the listing may ship
 */
export function checkListing({ listingDir, wearDir }) {
  const errors = [];

  if (!existsSync(listingDir)) {
    return [`Store-listing text directory is missing: ${listingDir}`];
  }

  const languages = readdirSync(listingDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  if (languages.length === 0) {
    return [`No store-listing language directory under ${listingDir}`];
  }

  const descriptions = new Map();
  for (const language of languages) {
    const dir = join(listingDir, language);
    for (const { file, limit } of FIELDS) {
      const path = join(dir, file);
      if (!existsSync(path)) {
        errors.push(
          `Missing ${language}/${file}. Every language must carry all of ` +
            `${FIELDS.map((f) => f.file).join(", ")}: Play's listing update ` +
            `replaces the whole resource, so an absent field is cleared.`,
        );
        continue;
      }
      const value = readFileSync(path, "utf8").trim();
      if (value.length === 0) errors.push(`${language}/${file} is empty`);
      else if (value.length > limit) {
        errors.push(`${language}/${file} is ${value.length} characters; Play allows ${limit}`);
      }
      if (file === "full_description.txt") descriptions.set(language, value.toLowerCase());
    }
  }

  const manifestPath = join(wearDir, "src/main/AndroidManifest.xml");
  if (!existsSync(manifestPath)) {
    errors.push(`Wear manifest is missing: ${manifestPath}`);
    return errors;
  }
  const detected = {
    manifest: readFileSync(manifestPath, "utf8"),
    kotlin: kotlinSources(join(wearDir, "src/main")),
  };

  for (const surface of WEAR_SURFACES) {
    if (!surface.detect(detected)) continue;
    const missing = languages.filter((language) => !descriptions.get(language)?.includes(surface.keyword));
    if (missing.length > 0) {
      errors.push(
        `The Wear app declares ${surface.label}, so the store listing must mention ` +
          `"${surface.keyword}" (Play's Wear App Quality Guidelines). Missing in: ` +
          `${missing.join(", ")}`,
      );
    }
  }

  return errors;
}

function main() {
  const root = process.env.PLAY_LISTING_ROOT ?? "android-app";
  const errors = checkListing({
    listingDir: join(root, "store-listing"),
    wearDir: join(root, "wear"),
  });
  if (errors.length > 0) {
    console.error(`Play store listing is not compliant:\n`);
    for (const error of errors) console.error(`  - ${error}`);
    process.exit(1);
  }
  console.log("Play store listing mentions every Wear surface the app ships.");
}

if (import.meta.url === `file://${process.argv[1]}`) main();