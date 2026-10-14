#!/usr/bin/env node
/**
 * Play store screenshot gate.
 *
 * Google Play rejected the Wear app because the listing's Wear screenshots did
 * not show "only the app interface". The screenshots are rendered by Roborazzi
 * from committed fixtures, and those fixtures painted the app surface on top of
 * Robolectric's default window background (#FAFAFA) instead of the app's own
 * background — so every capture framed the app as an inset card on a light
 * canvas, which is exactly the review finding.
 *
 * `:wear:verifyRoborazziDebug` cannot catch this: it compares a capture against
 * the golden that capture produced, so a wrong-but-stable background passes
 * forever. This gate encodes the invariant the golden cannot: every corner of a
 * Wear store screenshot must be the app's declared background colour (`val Bg`
 * in the Wear `Color.kt`). A fixture that forgets to paint it leaves the default
 * window colour in the corners and fails here, before the upload — which is the
 * framing Google flagged. (Corners, not the whole border: real content reaches
 * the edge on some screens, so a full-border rule would false-positive.)
 *
 * One implementation, on purpose. `src/test/play-screenshots.test.ts` drives the
 * failing paths through this module; a second copy of the rules would stay green
 * while this one decayed into a no-op.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { inflateSync } from "node:zlib";

/**
 * Read the app's background colour from the Wear `Color.kt`.
 *
 * The screenshot's border must equal this value, so the gate is tied to the
 * source of truth rather than a hard-coded hex: change the palette and the gate
 * follows, without anyone remembering to update it.
 *
 * `Color(0xAARRGGBB)` — alpha first, then red, green, blue.
 *
 * @param {string} colorKtPath
 * @returns {{r: number, g: number, b: number}}
 */
export function appBackgroundColor(colorKtPath) {
  const source = readFileSync(colorKtPath, "utf8");
  const match = /val\s+Bg\s*=\s*Color\(\s*0x([0-9A-Fa-f]{8})\s*\)/.exec(source);
  if (!match) {
    throw new Error(`Could not read the app background (val Bg) from ${colorKtPath}`);
  }
  const argb = Number.parseInt(match[1], 16);
  return { r: (argb >>> 16) & 0xff, g: (argb >>> 8) & 0xff, b: argb & 0xff };
}

/**
 * Per-channel tolerance for the border comparison.
 *
 * A properly painted border is the app background exactly, but an anti-aliased
 * edge of content that reaches the border can land a level or two off true black.
 * The defect this gate exists for is a *foreign* background (#FAFAFA, ~250 away),
 * so a small tolerance admits anti-aliasing while still failing anything that is
 * not the app's background.
 */
const CHANNEL_TOLERANCE = 12;

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/**
 * Decode a non-interlaced 8-bit RGBA PNG into a flat RGBA byte array.
 *
 * Roborazzi writes exactly this format (colour type 6, bit depth 8), and the
 * gate runs on bare Node with no image library — `zlib` is the only dependency,
 * and it is built in. Anything else is rejected rather than silently mis-read.
 *
 * @param {Buffer} buffer
 * @returns {{width: number, height: number, data: Buffer}}
 */
export function readImage(buffer) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < signature.length; i++) {
    if (buffer[i] !== signature[i]) throw new Error("not a PNG");
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") {
      idat.push(Buffer.from(data));
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }

  if (colorType !== 6 || bitDepth !== 8) {
    throw new Error(`unsupported PNG (colour type ${colorType}, bit depth ${bitDepth})`);
  }

  const raw = inflateSync(Buffer.concat(idat));
  const bpp = 4;
  const stride = width * bpp;
  const out = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const rowStart = y * (stride + 1) + 1;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const rawByte = raw[rowStart + x];
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= bpp ? prev[x - bpp] : 0;
      let value;
      switch (filter) {
        case 0:
          value = rawByte;
          break;
        case 1:
          value = rawByte + a;
          break;
        case 2:
          value = rawByte + b;
          break;
        case 3:
          value = rawByte + ((a + b) >> 1);
          break;
        case 4:
          value = rawByte + paeth(a, b, c);
          break;
        default:
          throw new Error(`unknown PNG filter ${filter}`);
      }
      cur[x] = value & 0xff;
    }
  }

  return { width, height, data: out };
}

/**
 * @param {{screenshotDir: string, colorFile: string}} options
 * @returns {string[]} one message per problem; empty means the screenshots may ship
 */
export function checkScreenshots({ screenshotDir, colorFile }) {
  if (!existsSync(screenshotDir)) {
    return [`Wear screenshot directory is missing: ${screenshotDir}`];
  }

  const files = readdirSync(screenshotDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".png"))
    .map((entry) => entry.name)
    .sort();
  if (files.length === 0) {
    return [`No Wear store screenshots (PNG) under ${screenshotDir}`];
  }

  const bg = appBackgroundColor(colorFile);
  const errors = [];

  for (const name of files) {
    const path = join(screenshotDir, name);
    let image;
    try {
      image = readImage(readFileSync(path));
    } catch (error) {
      errors.push(`${name} is not a readable 8-bit RGBA PNG: ${error.message}`);
      continue;
    }

    const { width, height, data } = image;
    if (width !== height) {
      errors.push(
        `${name} is ${width}x${height}; Play requires square (1:1) Wear screenshots`,
      );
    }

    const corners = [
      [0, 0],
      [width - 1, 0],
      [0, height - 1],
      [width - 1, height - 1],
    ];

    let offending = null;
    for (const [x, y] of corners) {
      const i = (y * width + x) * 4;
      const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
      const matches =
        a === 255 &&
        Math.abs(r - bg.r) <= CHANNEL_TOLERANCE &&
        Math.abs(g - bg.g) <= CHANNEL_TOLERANCE &&
        Math.abs(b - bg.b) <= CHANNEL_TOLERANCE;
      if (!matches) {
        offending = { x, y, r, g, b, a };
        break;
      }
    }
    if (offending) {
      errors.push(
        `${name} has rgb(${offending.r},${offending.g},${offending.b}) a=${offending.a} ` +
          `at its (${offending.x},${offending.y}) corner; every corner must be the app ` +
          `background rgb(${bg.r},${bg.g},${bg.b}) (±${CHANNEL_TOLERANCE}). A capture ` +
          `framed on any other colour is not "only the app interface" (the Play ` +
          `rejection), so the fixture must paint MaterialTheme.colorScheme.background ` +
          `across the whole capture.`,
      );
    }
  }

  return errors;
}

/** Flags the gate accepts. Anything else is an error, never a silent default. */
const FLAGS = ["dir", "color"];

function die(message) {
  // Fail closed. A mistyped flag must never fall back to the defaults and report
  // success for a directory nobody asked about.
  console.error(`check-play-screenshots: ${message}`);
  process.exit(2);
}

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
    if (value === undefined || value.startsWith("--")) die(`--${name} needs a path`);
    parsed[name] = value;
  }
  return parsed;
}

function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const root = process.env.PLAY_LISTING_ROOT ?? "android-app";
  const screenshotDir = parsed.dir ?? join(root, "wear/src/test/screenshots/store-listing");
  const colorFile =
    parsed.color ?? join(root, "wear/src/main/java/dev/convocados/wear/ui/theme/Color.kt");

  const errors = checkScreenshots({ screenshotDir, colorFile });
  if (errors.length > 0) {
    console.error(`Play Wear screenshots are not compliant (${screenshotDir}):\n`);
    for (const error of errors) console.error(`  - ${error}`);
    process.exit(1);
  }
  console.log(`Play Wear screenshots show only the app interface (${screenshotDir}).`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
