import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { README_OUT_DIR, README_SHOTS } from "../../scripts/screenshots/readme";
import { assertUniqueShotNames, publishShots } from "../../scripts/screenshots/capture";

const EXPECTED_FILES = [
  "01-landing.png",
  "01-create-game.png",
  "02-create-game-advanced.png",
  "03-dashboard.png",
  "04-event-detail.png",
  "05-event-history.png",
  "06-event-rankings.png",
  "07-event-settings.png",
  "08-event-attendance.png",
  "09-event-log.png",
  "10-user-profile.png",
  "11-public-games.png",
  "12-user-menu.png",
];

describe("README screenshot profile", () => {
  it("covers every committed screenshot exactly once", () => {
    const names = README_SHOTS.map((s) => `${s.name}.png`).sort();
    expect(names).toEqual([...EXPECTED_FILES].sort());
    expect(() => assertUniqueShotNames(README_SHOTS)).not.toThrow();
  });

  it("every shot name matches a file committed under docs/screenshots/web", () => {
    const onDisk = fs.readdirSync(README_OUT_DIR).filter((f) => f.endsWith(".png")).sort();
    expect(onDisk).toEqual([...EXPECTED_FILES].sort());
  });

  it("scores against the deterministic fixture event", () => {
    const eventShots = README_SHOTS.filter((s) => s.path.includes("/events/"));
    expect(eventShots.length).toBeGreaterThan(0);
    for (const shot of eventShots) {
      expect(shot.path).toContain("/events/screenshot-hero");
    }
  });
});

describe("assertUniqueShotNames", () => {
  it("throws on a duplicate name", () => {
    expect(() =>
      assertUniqueShotNames([
        { name: "dup", path: "/a" },
        { name: "dup", path: "/b" },
      ]),
    ).toThrow(/Duplicate screenshot name/);
  });
});

describe("publishShots", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function tempDir(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    dirs.push(dir);
    return dir;
  }

  it("moves captured PNGs into place and leaves non-PNG files alone", () => {
    const temp = tempDir("shots-src-");
    const out = tempDir("shots-out-");
    fs.writeFileSync(path.join(temp, "a.png"), "a");
    fs.writeFileSync(path.join(temp, "b.png"), "b");
    fs.writeFileSync(path.join(temp, "notes.txt"), "ignore me");

    publishShots(temp, out);

    expect(fs.readdirSync(out).sort()).toEqual(["a.png", "b.png"]);
  });

  it("replaces an existing file with the same name", () => {
    const temp = tempDir("shots-src-");
    const out = tempDir("shots-out-");
    fs.writeFileSync(path.join(out, "a.png"), "old");
    fs.writeFileSync(path.join(temp, "a.png"), "new");

    publishShots(temp, out);

    expect(fs.readFileSync(path.join(out, "a.png"), "utf8")).toBe("new");
  });
});
