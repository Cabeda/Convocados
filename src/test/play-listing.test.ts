/**
 * Play store listing gate.
 *
 * Play rejected the Wear app for a listing that did not mention the quick-game
 * tile. `scripts/check-play-listing.mjs` is the gate that prevents a recurrence,
 * and these tests drive *that module* rather than re-implementing its rules: a
 * second implementation would stay green while the real gate decayed.
 *
 * Most fixtures point at the real `android-app/wear`, so those obligations are
 * derived from the module as it is today. The set of *detectable* surfaces is
 * fixed in the checker and is not self-extending — a surface outside it is caught
 * in review — so a surface the app does not have yet (a complication) is
 * exercised against a fixture module instead, in both directions.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";

import { checkListing } from "../../scripts/check-play-listing.mjs";

const root = resolve(__dirname, "../..");
const committedListing = join(root, "android-app/store-listing");
const wearDir = join(root, "android-app/wear");

/** A copy of the committed listing the test can damage. */
let listingDir: string;

/** Throwaway wear modules, so a detector can be exercised for a surface the real app lacks. */
const fixtureDirs: string[] = [];

function check() {
  return checkListing({ listingDir, wearDir });
}

function checkAgainst(wearDir: string) {
  return checkListing({ listingDir, wearDir });
}

/**
 * A minimal wear module containing `kotlin`. No manifest intent filters and no
 * `OngoingActivity`, so only the detector under test can fire.
 */
function wearFixture(kotlin: string): string {
  const dir = mkdtempSync(join(tmpdir(), "play-wear-"));
  fixtureDirs.push(dir);
  const main = join(dir, "src/main");
  mkdirSync(join(main, "java/dev/convocados/wear/fake"), { recursive: true });
  writeFileSync(join(main, "AndroidManifest.xml"), "<manifest />\n", "utf8");
  writeFileSync(join(main, "java/dev/convocados/wear/fake/Fake.kt"), kotlin, "utf8");
  return dir;
}

function fullDescription() {
  return readFileSync(join(listingDir, "en-US/full-description.txt"), "utf8");
}

function setFullDescription(value: string) {
  writeFileSync(join(listingDir, "en-US/full-description.txt"), value, "utf8");
}

beforeEach(() => {
  listingDir = mkdtempSync(join(tmpdir(), "play-listing-"));
  cpSync(join(committedListing, "en-US"), join(listingDir, "en-US"), { recursive: true });
});

afterEach(() => {
  rmSync(listingDir, { recursive: true, force: true });
  for (const dir of fixtureDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("committed Play listing", () => {
  it("passes the gate as committed", () => {
    expect(check()).toEqual([]);
  });

  it("rejects a field file Gradle Play Publisher would not read", () => {
    // The bug this catches: GPP reads `full-description.txt`, not
    // `full_description.txt`. The underscored file looked published, the gate
    // passed, and Play rejected the commit with "This app has no short
    // description" — the listing shipped with a title and nothing else.
    writeFileSync(join(listingDir, "en-US/full_description.txt"), "Convocados\n", "utf8");

    expect(check().join("\n")).toMatch(
      /full_description\.txt is not a file Gradle Play Publisher reads/,
    );
  });

  it("carries all three text fields under the names the uploader reads", () => {
    for (const field of ["title.txt", "short-description.txt", "full-description.txt"]) {
      expect(() => readFileSync(join(committedListing, "en-US", field), "utf8")).not.toThrow();
    }
  });
});

describe("Wear surfaces the gate derives from android-app/wear", () => {
  it.each([
    ["tile", /must mention "tile"/],
    ["ongoing", /must mention "ongoing"/],
  ])("fails when the description stops mentioning the %s", (keyword, expected) => {
    // Remove the word without touching the structure of the copy around it.
    setFullDescription(fullDescription().replace(new RegExp(keyword, "gi"), "carousel"));

    const errors = check();

    expect(errors.join("\n")).toMatch(expected);
  });

  it("names the surface in the error, so the message is actionable", () => {
    setFullDescription(fullDescription().replace(/tile/gi, "carousel"));

    expect(check().join("\n")).toMatch(/Wear tile \(BIND_TILE_PROVIDER \/ TileService\)/);
  });

  it("arms the complication detector against a fixture module, in both directions", () => {
    // The real module ships no complication, so the real gate cannot exercise
    // that detector. A fixture can. Both directions matter: without the second
    // assertion, a detector that fired on everything would pass the first.
    const module = wearFixture("class Fake : ComplicationProvider() {}\n");

    expect(checkAgainst(module).join("\n")).toMatch(/must mention "complication"/);

    setFullDescription(`${fullDescription()}\nAlso a watch face complication.`);
    expect(checkAgainst(module)).toEqual([]);
  });
});

describe("Play's per-field requirements", () => {
  it("fails when a language is missing a field, because it would not be sent", () => {
    rmSync(join(listingDir, "en-US/short-description.txt"));

    expect(check().join("\n")).toMatch(/Missing en-US\/short-description\.txt/);
  });

  it("fails when a field is empty", () => {
    writeFileSync(join(listingDir, "en-US/title.txt"), "   ", "utf8");

    expect(check().join("\n")).toMatch(/en-US\/title\.txt is empty/);
  });

  it.each([
    ["title.txt", 31],
    ["short-description.txt", 81],
    ["full-description.txt", 4001],
  ])("fails when %s exceeds Play's limit", (field, length) => {
    writeFileSync(join(listingDir, `en-US/${field}`), "x".repeat(length), "utf8");

    expect(check().join("\n")).toMatch(new RegExp(`${field} is ${length} characters`));
  });

  it("checks every language directory, not just the first", () => {
    mkdirSync(join(listingDir, "pt-BR"));
    for (const field of ["title.txt", "short-description.txt", "full-description.txt"]) {
      writeFileSync(join(listingDir, `pt-BR/${field}`), "Convocados", "utf8");
    }

    expect(check().join("\n")).toMatch(/Missing in: pt-BR/);
  });
});

describe("the store-listing app icon", () => {
  /**
   * Play fills the listing's icon once, from the first bundle it sees, and never
   * derives it again — so an icon nobody uploads stays whatever it was on day one.
   * That is the bug: the launcher icon became a whistle and the store page kept
   * the old "C" glyph, because no committed copy of the icon existed at all.
   */
  const writeIcon = (bytes: Buffer, where = "icon.png") =>
    writeFileSync(join(listingDir, "en-US", where), bytes);

  /** A valid 512x512 opaque PNG with one pixel of the given colour type. */
  function png(width: number, height: number, colourType: number) {
    const bytes = Buffer.alloc(33);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes, 0);
    bytes.writeUInt32BE(13, 8); // IHDR length
    bytes.write("IHDR", 12, "ascii");
    bytes.writeUInt32BE(width, 16);
    bytes.writeUInt32BE(height, 20);
    bytes[24] = 8; // bit depth
    bytes[25] = colourType; // 2 = truecolor (opaque), 6 = truecolor + alpha
    return bytes;
  }

  it("accepts the committed icon", () => {
    expect(() => readFileSync(join(committedListing, "en-US/icon.png"))).not.toThrow();
    expect(check()).toEqual([]);
  });

  it("fails when the icon is missing, rather than leaving Play's stale copy in place", () => {
    rmSync(join(listingDir, "en-US/icon.png"));

    expect(check().join("\n")).toMatch(/Missing en-US\/icon\.png/);
  });

  it("accepts the staged layout, where Gradle Play Publisher reads the icon", () => {
    // GPP 4.x reads images from `listings/<lang>/graphics/<slot>/`. An icon left
    // only in the language root would be uploaded as nothing, and the gate runs
    // over the staged copy too — so both locations must satisfy it.
    mkdirSync(join(listingDir, "en-US/graphics/icon"), { recursive: true });
    rmSync(join(listingDir, "en-US/icon.png"));
    writeIcon(png(512, 512, 2), join("graphics", "icon", "icon.png"));

    expect(check()).toEqual([]);
  });

  it.each([
    [256, 256, /icon\.png is 256x256; Play's app icon must be 512x512/],
    [512, 1024, /icon\.png is 512x1024/],
  ])("fails when the icon is %ix%i", (width, height, expected) => {
    writeIcon(png(width, height, 2));

    expect(check().join("\n")).toMatch(expected);
  });

  it("fails when the icon is not a PNG at all", () => {
    writeIcon(Buffer.from("#1B6B4A", "utf8"));

    expect(check().join("\n")).toMatch(/icon\.png is not a PNG/);
  });

  it("fails when the icon carries transparency", () => {
    writeIcon(png(512, 512, 6));

    expect(check().join("\n")).toMatch(/icon\.png carries an alpha channel/);
  });

  it("requires the icon of every language, not just en-US", () => {
    mkdirSync(join(listingDir, "pt-BR"));
    for (const field of ["title.txt", "short-description.txt", "full-description.txt"]) {
      writeFileSync(join(listingDir, `pt-BR/${field}`), "Convocados", "utf8");
    }

    expect(check().join("\n")).toMatch(/Missing pt-BR\/icon\.png/);
  });
});

describe("degenerate inputs", () => {
  it("fails when the listing directory is missing entirely", () => {
    rmSync(listingDir, { recursive: true, force: true });

    expect(check().join("\n")).toMatch(/Store-listing text directory is missing/);
  });

  it("fails when the wear module is missing, rather than skipping the check", () => {
    const errors = checkListing({ listingDir, wearDir: join(root, "android-app/nope") });

    expect(errors.join("\n")).toMatch(/Wear manifest is missing/);
  });

  it("holds the staged layout to the same rules as the source", () => {
    // The staged copy is a different directory and is what Play receives, so the
    // rules must bite there too — a half-staged field has to fail.
    const staged = mkdtempSync(join(tmpdir(), "play-staged-"));
    fixtureDirs.push(staged);
    cpSync(join(listingDir, "en-US"), join(staged, "en-US"), { recursive: true });
    rmSync(join(staged, "en-US/title.txt"));

    expect(checkListing({ listingDir: staged, wearDir }).join("\n")).toMatch(
      /Missing en-US\/title\.txt/,
    );
  });
});
describe("the CLI fails closed", () => {
  const cli = (args: string[]) =>
    spawnSync(process.execPath, [join(root, "scripts/check-play-listing.mjs"), ...args], {
      encoding: "utf8",
    });

  it.each([
    [["--listng", "android-app/store-listing"], "unknown flag"],
    [["--listing"], "needs a directory"],
    [["--listing", "--wear", "x"], "needs a directory"],
    [["stray"], "unexpected argument"],
    [["--listing=android-app/store-listing"], "unknown flag"],
  ])("rejects %j instead of falling back to the defaults", (args, expected) => {
    // A mistyped flag must never silently check a different directory and report
    // success — that is the failure this whole gate exists to prevent.
    const result = cli(args as string[]);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain(expected as string);
  });

  it("accepts the documented invocation", () => {
    const result = cli([]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("android-app/store-listing");
  });
});
