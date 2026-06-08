/**
 * Feature Parity Validation Test
 *
 * Validates that feature-parity.yaml:
 * 1. Is valid YAML
 * 2. Every feature has web, android, and wearos boolean fields
 * 3. Every capability (if present) has the same three fields
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { parse } from "yaml";

const PLATFORMS = ["web", "android", "wearos"];

function loadManifest(): Record<string, unknown> {
  const filePath = resolve(__dirname, "../../feature-parity.yaml");
  const content = readFileSync(filePath, "utf-8");
  return parse(content) as Record<string, unknown>;
}

describe("Feature Parity Manifest", () => {
  const manifest = loadManifest();

  it("should parse as valid YAML with at least one feature", () => {
    expect(Object.keys(manifest).length).toBeGreaterThan(0);
  });

  for (const [feature, value] of Object.entries(manifest)) {
    describe(`Feature: ${feature}`, () => {
      const entry = value as Record<string, unknown>;

      for (const platform of PLATFORMS) {
        it(`has "${platform}" boolean`, () => {
          expect(typeof entry[platform]).toBe("boolean");
        });
      }

      if (entry.capabilities && typeof entry.capabilities === "object") {
        const caps = entry.capabilities as Record<string, Record<string, unknown>>;
        for (const [cap, capValue] of Object.entries(caps)) {
          describe(`Capability: ${cap}`, () => {
            for (const platform of PLATFORMS) {
              it(`has "${platform}" boolean`, () => {
                expect(typeof capValue[platform]).toBe("boolean");
              });
            }
          });
        }
      }
    });
  }
});
