import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";

import { syncFeatureGraphic } from "../../scripts/sync-play-feature-graphic.mjs";

const root = resolve(__dirname, "../..");
let tempDir: string;
let sourcePath: string;
let targetPath: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "play-feature-graphic-"));
  sourcePath = join(tempDir, "source.png");
  targetPath = join(tempDir, "listings/en-US/graphics/feature-graphic/1.png");
  writeFileSync(sourcePath, readFileSync(join(root, "docs/feature-graphic.png")));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("syncFeatureGraphic", () => {
  it("copies the current source over a stale staged listing image", () => {
    mkdirSync(join(tempDir, "listings/en-US/graphics/feature-graphic"), { recursive: true });
    writeFileSync(targetPath, "stale listing graphic");

    syncFeatureGraphic(sourcePath, targetPath);

    expect(readFileSync(targetPath)).toEqual(readFileSync(sourcePath));
  });

  it("rejects a PNG with dimensions other than 1024 by 500", () => {
    const invalid = readFileSync(sourcePath);
    invalid.writeUInt32BE(1023, 16);
    writeFileSync(sourcePath, invalid);

    expect(() => syncFeatureGraphic(sourcePath, targetPath)).toThrow(/1024x500/);
  });

  it("rejects a feature graphic above Play's 15 MB limit", () => {
    const oversized = Buffer.alloc(15 * 1024 * 1024 + 1);
    writeFileSync(sourcePath, oversized);

    expect(() => syncFeatureGraphic(sourcePath, targetPath)).toThrow(/15 MB/);
  });
});
