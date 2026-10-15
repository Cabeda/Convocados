#!/usr/bin/env node
/**
 * Play store listing gate.
 *
 * Google Play rejected the Wear app because the listing did not mention the
 * quick-game tile, though the tile had shipped for months — nothing in the repo
 * recorded the text, so nothing noticed. The text is committed at
 * `android-app/store-listing/<lang>/`; this is the gate that keeps it honest
 * (ADR 0049, `android-app/PLAY_STORE_PUBLISHING.md`).
 *
 * It rejects three classes of failure: an incomplete listing (every language needs
 * all three fields, non-empty, within Play's limit — the upload sends only what
 * the layout holds, so an absent field is not ours to explain), a missing or
 * unusable app icon (Play never re-derives one, so an icon outside this repo is
 * stale for good), and a Wear surface the app ships but the description does not
 * mention. Each obligation is detected from the wear module rather than asserted from a
 * list of features, but the set of detectable surfaces is fixed below and is not
 * self-extending: a surface outside it is caught in review, not here.
 *
 * One implementation, on purpose. `src/test/play-listing.test.ts` drives the
 * failing paths through this module; a second copy of the rules would stay green
 * while this one decayed into a no-op.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Play's per-field character limits (Android Publisher `Listings` resource).
 *
 * The filenames are Gradle Play Publisher's, not ours: GPP 4.1.1 reads
 * `title.txt`, `short-description.txt`, `full-description.txt` and
 * `video-url.txt` (com/github/triplet/gradle/play/internal/ListingDetail). They
 * are hyphenated. Underscored names are silently ignored by the uploader, which
 * then commits a listing with a title and no description — an empty field Play
 * refuses to accept, so the whole edit fails with "This app has no short
 * description". Rename one of these and the gate says so.
 */
const FIELDS = [
  { file: "title.txt", limit: 30 },
  { file: "short-description.txt", limit: 80 },
  { file: "full-description.txt", limit: 4000 },
];

/**
 * The store-listing app icon.
 *
 * Play fills the listing's icon once, from the first bundle it sees, and never
 * derives it again — so an icon held only in Play Console stays whatever it was on
 * day one. That is not hypothetical: the launcher icon became a whistle in Aug 2026
 * and the store page kept the old "C" glyph for months, because nothing in this repo
 * ever uploaded an icon. The committed copy is `store-listing/<lang>/icon.png`;
 * Gradle Play Publisher 4.x reads it from `listings/<lang>/graphics/icon/`, so both
 * locations are accepted (source and staged layout).
 */
const ICON = {
  file: "icon.png",
  staged: join("graphics", "icon", "icon.png"),
  size: 512,
};

/**
 * What is wrong with `path` as a Play app icon, or undefined when it is fine.
 *
 * PNG header only: width/height sit at bytes 16..23 and the colour type at 25, so
 * this needs no image library. Play wants a 512×512 icon and renders the store page
 * on white, so a transparent one shows as a white square — the same reason
 * `check-play-screenshots.mjs` refuses translucent store art.
 */
function iconProblem(path) {
  const header = readFileSync(path);
  if (header.length < 26 || !header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return "is not a PNG";
  }
  const width = header.readUInt32BE(16);
  const height = header.readUInt32BE(20);
  if (width !== ICON.size || height !== ICON.size) {
    return `is ${width}x${height}; Play's app icon must be ${ICON.size}x${ICON.size}`;
  }
  if (header[25] !== 2) {
    return `carries an alpha channel (PNG colour type ${header[25]}); Play renders the store page on white, so the icon must be opaque`;
  }
  return undefined;
}

/**
 * Wear surfaces Play expects the listing to describe. `detect` reads the module
 * rather than the listing, so adding one of these surfaces to the app adds the
 * obligation without touching this file.
 *
 * The list is bounded by Play's Wear App Quality Guidelines, which name tiles,
 * complications and watch faces. A watch face is deliberately not detected: the
 * copy legitimately says "watch face" when it describes the ongoing-activity
 * indicator, so the keyword would be trivially satisfied. The list is therefore
 * **not** self-extending — a surface outside these three is caught in review,
 * which is why adding a Wear surface means editing the description in the same PR.
 *
 * The detectors favour over-triggering: a false positive costs a sentence of copy,
 * a false negative is the rejection this script exists to prevent.
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
  {
    keyword: "complication",
    label: "a watch face complication (ComplicationProvider)",
    detect: ({ kotlin }) => /ComplicationProvider|ComplicationSlot/.test(kotlin),
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
            `${FIELDS.map((f) => f.file).join(", ")}: the upload sends only ` +
            `what the layout holds, so this field would not be sent at all.`,
        );
        continue;
      }
      const value = readFileSync(path, "utf8").trim();
      if (value.length === 0) errors.push(`${language}/${file} is empty`);
      else if (value.length > limit) {
        errors.push(`${language}/${file} is ${value.length} characters; Play allows ${limit}`);
      }
      if (file === "full-description.txt") descriptions.set(language, value.toLowerCase());
    }

    const icon = [ICON.file, ICON.staged]
      .map((candidate) => join(dir, candidate))
      .find((candidate) => existsSync(candidate));
    if (!icon) {
      errors.push(
        `Missing ${language}/${ICON.file}. Play derives the listing icon once and never ` +
          `again, so without a committed copy the store page keeps whatever icon it had ` +
          `on its first release.`,
      );
    } else {
      const problem = iconProblem(icon);
      if (problem) errors.push(`${language}/${ICON.file} ${problem}`);
    }

    // A file the uploader does not read is worse than a missing one: it looks
    // like it is being published, and the gate would pass. This is exactly how
    // `full_description.txt` shipped and Play rejected the commit with "This app
    // has no short description".
    const known = new Set(FIELDS.map((f) => f.file));
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".txt")) continue;
      if (known.has(entry.name)) continue;
      errors.push(
        `${language}/${entry.name} is not a file Gradle Play Publisher reads ` +
          `(${[...known].join(", ")}), so it would be uploaded as nothing`,
      );
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

/** Flags the gate accepts. Anything else is an error, never a silent default. */
const FLAGS = ["listing", "wear"];

function parseArgs(args) {
  const parsed = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith("--")) die(`unexpected argument "${arg}"`);
    const name = arg.slice(2);
    if (!FLAGS.includes(name)) {
      die(`unknown flag "--${name}" (expected ${FLAGS.map((f) => `--${f}`).join(" or ")})`);
    }
    const value = args[++i];
    if (value === undefined || value.startsWith("--")) die(`--${name} needs a directory`);
    parsed[name] = value;
  }
  return parsed;
}

function die(message) {
  // Fail closed. A mistyped flag must never fall back to the default paths and
  // report success for a directory nobody asked about.
  console.error(`check-play-listing: ${message}`);
  process.exit(2);
}

function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const root = process.env.PLAY_LISTING_ROOT ?? "android-app";
  // --listing points the gate at the *staged* layout Gradle Play Publisher
  // uploads (android-app/<module>/src/main/play/listings), not just the source.
  // Those are different directories, and the staged copy is what reaches Play, so
  // a staging defect must be caught here too.
  const listingDir = parsed.listing ?? join(root, "store-listing");
  const wearDir = parsed.wear ?? join(root, "wear");

  const errors = checkListing({ listingDir, wearDir });
  if (errors.length > 0) {
    console.error(`Play store listing is not compliant (${listingDir}):\n`);
    for (const error of errors) console.error(`  - ${error}`);
    process.exit(1);
  }
  console.log(`Play store listing mentions every Wear surface the app ships (${listingDir}).`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();