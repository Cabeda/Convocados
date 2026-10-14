/**
 * Play store screenshot gate.
 *
 * Google Play rejected the Wear app because the listing's Wear screenshots did
 * not show "only the app interface". `scripts/check-play-screenshots.mjs` is the
 * gate that prevents a recurrence, and these tests drive *that module* rather
 * than re-implementing its rules: a second implementation would stay green while
 * the real gate decayed.
 *
 * The passing case points at the committed screenshots, so it exercises the real
 * artifacts. The failing cases synthesize PNGs, because the defect the gate
 * exists for — a screenshot rendered on a foreign background — is exactly what
 * the committed artifacts must never be again.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { deflateSync } from "node:zlib";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  appBackgroundColor,
  checkScreenshots,
  readImage,
} from "../../scripts/check-play-screenshots.mjs";

const root = resolve(__dirname, "../..");
const committedDir = join(root, "android-app/wear/src/test/screenshots/store-listing");
const colorFile = join(
  root,
  "android-app/wear/src/main/java/dev/convocados/wear/ui/theme/Color.kt",
);

// ── A minimal PNG encoder, so a failing fixture can be built without shipping
//    a deliberately-broken asset in the repo. RGBA8, no interlace, filter 0. ──

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

/** @param {number} width @param {number} height @param {(x:number,y:number)=>[number,number,number,number]} pixel */
function png(width: number, height: number, pixel: (x: number, y: number) => number[]): Buffer {
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixel(x, y);
      const i = rowStart + 1 + x * 4;
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
      raw[i + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "play-shots-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeShot(name: string, buffer: Buffer) {
  writeFileSync(join(dir, name), buffer);
}

function check() {
  return checkScreenshots({ screenshotDir: dir, colorFile });
}

/** The app background the real palette declares (true black). */
function appBg(): number[] {
  const { r, g, b } = appBackgroundColor(colorFile);
  return [r, g, b];
}

describe("committed Wear store screenshots", () => {
  it("passes the gate as committed", () => {
    const errors = checkScreenshots({ screenshotDir: committedDir, colorFile });
    expect(errors).toEqual([]);
  });

  it("reads the app background from Color.kt, not a hard-coded hex", () => {
    const { r, g, b } = appBackgroundColor(colorFile);
    expect([r, g, b]).toEqual([0, 0, 0]);
  });
});

describe("the rejection this gate prevents", () => {
  it("rejects a screenshot rendered on the default window background", () => {
    // Robolectric's #FAFAFA window colour is the exact framing Google flagged.
    writeShot("games.png", png(8, 8, () => [250, 250, 250, 255]));
    const errors = check();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("games.png");
    expect(errors[0]).toContain("only the app interface");
  });

  it("rejects a transparent border", () => {
    const [r, g, b] = appBg();
    writeShot("games.png", png(8, 8, (x, y) => (x === 0 || y === 0 || x === 7 || y === 7 ? [r, g, b, 0] : [r, g, b, 255])));
    const errors = check();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("a=0");
  });

  it("accepts a full-bleed capture on the app background", () => {
    const [r, g, b] = appBg();
    writeShot("games.png", png(8, 8, () => [r, g, b, 255]));
    expect(check()).toEqual([]);
  });

  it("tolerates anti-aliased edge pixels a few levels off the background", () => {
    const [r, g, b] = appBg();
    writeShot(
      "games.png",
      png(8, 8, (x, y) =>
        x === 0 || y === 0 || x === 7 || y === 7 ? [r + 3, g + 1, b + 2, 255] : [r, g, b, 255],
      ),
    );
    expect(check()).toEqual([]);
  });
});

describe("Play's square requirement", () => {
  it("rejects a non-square screenshot", () => {
    const [r, g, b] = appBg();
    writeShot("games.png", png(4, 6, () => [r, g, b, 255]));
    const errors = check();
    expect(errors).toEqual(
      expect.arrayContaining([expect.stringContaining("Play requires square (1:1)")]),
    );
  });
});

describe("degenerate inputs", () => {
  it("fails when the screenshot directory is missing", () => {
    expect(checkScreenshots({ screenshotDir: join(dir, "does-not-exist"), colorFile })).toEqual([
      expect.stringContaining("missing"),
    ]);
  });

  it("fails when the directory holds no screenshots", () => {
    expect(check()).toEqual([expect.stringContaining("No Wear store screenshots")]);
  });

  it("fails when a file is not a readable RGBA PNG", () => {
    writeFileSync(join(dir, "games.png"), Buffer.from("not a png"));
    expect(check()[0]).toContain("not a PNG");
  });
});

describe("the CLI fails closed", () => {
  it("rejects an unknown flag instead of using the defaults", () => {
    const result = spawnSync(
      process.execPath,
      [join(root, "scripts/check-play-screenshots.mjs"), "--wibble", "x"],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("unknown flag");
  });

  it("accepts --dir pointing at a compliant directory", () => {
    const [r, g, b] = appBg();
    writeShot("games.png", png(4, 4, () => [r, g, b, 255]));
    const result = spawnSync(
      process.execPath,
      [join(root, "scripts/check-play-screenshots.mjs"), "--dir", dir, "--color", colorFile],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(0);
  });
});

describe("readImage", () => {
  it("decodes a PNG round-trip", () => {
    const image = readImage(png(2, 2, () => [1, 2, 3, 255]));
    expect(image.width).toBe(2);
    expect(image.height).toBe(2);
    expect([...image.data.subarray(0, 4)]).toEqual([1, 2, 3, 255]);
  });
});
