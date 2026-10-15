#!/usr/bin/env node
/**
 * Stage the committed Play feature graphic into Gradle Play Publisher's listing layout.
 * The deploy runs this on every release, so the staged image always follows the
 * current source instead of leaving Play with an older manually uploaded graphic.
 */

import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const MAX_BYTES = 15 * 1024 * 1024;

/**
 * Validate and copy the feature graphic, replacing any stale staged image.
 *
 * @param {string} sourcePath
 * @param {string} targetPath
 * @returns {string} targetPath
 */
export function syncFeatureGraphic(sourcePath, targetPath) {
  const image = readFileSync(sourcePath);
  if (image.length > MAX_BYTES) {
    throw new Error(`Feature graphic is ${image.length} bytes; Play allows up to 15 MB`);
  }
  if (
    image.length < 24 ||
    !image.subarray(0, 8).equals(PNG_SIGNATURE) ||
    image.toString("ascii", 12, 16) !== "IHDR"
  ) {
    throw new Error(`Feature graphic must be a valid PNG: ${sourcePath}`);
  }

  const width = image.readUInt32BE(16);
  const height = image.readUInt32BE(20);
  if (width !== 1024 || height !== 500) {
    throw new Error(`Feature graphic must be 1024x500; found ${width}x${height}: ${sourcePath}`);
  }

  mkdirSync(dirname(targetPath), { recursive: true });
  copyFileSync(sourcePath, targetPath);
  return targetPath;
}

function parseArgs(args) {
  if (args.length === 0) return {};
  if (args.length !== 4 || args[0] !== "--source" || args[2] !== "--target") {
    throw new Error("Usage: sync-play-feature-graphic.mjs [--source <png> --target <png>]");
  }
  return { source: args[1], target: args[3] };
}

function main() {
  const { source, target } = parseArgs(process.argv.slice(2));
  const root = process.cwd();
  const sourcePath = resolve(root, source ?? "docs/feature-graphic.png");
  const targetPath = resolve(
    root,
    target ?? "android-app/app/src/main/play/listings/en-US/graphics/feature-graphic/1.png",
  );
  syncFeatureGraphic(sourcePath, targetPath);
  console.log(`Synced Play feature graphic: ${sourcePath} -> ${targetPath}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`sync-play-feature-graphic: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}
