/**
 * The queue is the Fixer's whole input, so the ordering rules are tested rather
 * than trusted: a wrong predicate here spends an hour on the wrong Issue, or
 * re-spends it on an Issue that already has a Change.
 */
import { describe, expect, it } from "vitest";
import {
  CLAIM_TTL_MS,
  type IssueSummary,
  inLane,
  isQueued,
  pickNext,
} from "../../scripts/factory/next-issue";

const NOW = Date.parse("2026-11-25T12:00:00Z");

function issue(overrides: Partial<IssueSummary> = {}): IssueSummary {
  return {
    number: 100,
    createdAt: "2026-11-20T08:00:00Z",
    labels: [{ name: "factory:explored" }],
    comments: [],
    ...overrides,
  };
}

function claim(createdAt: string): IssueSummary["comments"][number] {
  return { body: "factory: claiming", createdAt };
}

describe("pickNext", () => {
  it("returns the oldest queued Issue first", () => {
    const newest = issue({ number: 102, createdAt: "2026-11-22T08:00:00Z" });
    const oldest = issue({ number: 101, createdAt: "2026-11-19T08:00:00Z" });
    expect(pickNext([newest, oldest], [], NOW)?.number).toBe(101);
  });

  it("breaks a same-instant tie by Issue number", () => {
    const a = issue({ number: 205 });
    const b = issue({ number: 204 });
    expect(pickNext([a, b], [], NOW)?.number).toBe(204);
  });

  it("returns nothing when the queue is empty", () => {
    expect(pickNext([], [], NOW)).toBeNull();
  });
});

describe("isQueued", () => {
  it("requires the Explorer's label", () => {
    expect(isQueued(issue({ labels: [] }), [], NOW)).toBe(false);
  });

  it("skips a Blocked Issue until a human clears it", () => {
    const blocked = issue({ labels: [{ name: "factory:explored" }, { name: "factory:blocked" }] });
    expect(isQueued(blocked, [], NOW)).toBe(false);
  });

  it("leaves a promoted Issue to the Factory", () => {
    const promoted = issue({
      labels: [{ name: "factory:explored" }, { name: "ready-for-agent" }],
    });
    expect(isQueued(promoted, [], NOW)).toBe(false);
  });

  it("skips an Issue that already has an open Change", () => {
    expect(isQueued(issue({ number: 100 }), ["factory/100-roster-seam"], NOW)).toBe(false);
  });

  it("does not mistake another Issue's Change for this one", () => {
    expect(isQueued(issue({ number: 100 }), ["factory/1000-something"], NOW)).toBe(true);
  });

  it("honours a live Claim", () => {
    const claimed = issue({ comments: [claim(new Date(NOW - CLAIM_TTL_MS + 60_000).toISOString())] });
    expect(isQueued(claimed, [], NOW)).toBe(false);
  });

  it("reclaims an Issue whose Claim went stale", () => {
    const stale = issue({ comments: [claim(new Date(NOW - CLAIM_TTL_MS - 60_000).toISOString())] });
    expect(isQueued(stale, [], NOW)).toBe(true);
  });

  it("reclaims after a newer claim replaces an older one", () => {
    const reclaimed = issue({
      comments: [
        claim(new Date(NOW - CLAIM_TTL_MS - 60_000).toISOString()),
        claim(new Date(NOW - 60_000).toISOString()),
      ],
    });
    expect(isQueued(reclaimed, [], NOW)).toBe(false);
  });
});

describe("lanes partition the queue without racing", () => {
  // Three runs work the backlog at once. A Claim is written after the pick, so
  // two lanes reading at the same moment would both choose the oldest Issue;
  // the partition makes that impossible instead of hoping.
  const a = issue({ number: 1711 });
  const b = issue({ number: 1712 });
  const c = issue({ number: 1713 });

  it("assigns each Issue to exactly one lane", () => {
    const lanes = [0, 1, 2].map((lane) =>
      [a, b, c].filter((i) => inLane(i, { lane, lanes: 3 })).map((i) => i.number),
    );
    expect(lanes.flat().sort()).toEqual([1711, 1712, 1713]);
    for (const lane of lanes) expect(lane.length).toBeLessThanOrEqual(2);
  });

  it("is the whole queue when there is one lane", () => {
    expect(inLane(a, { lane: 0, lanes: 1 })).toBe(true);
    expect(pickNext([b, a], [], NOW, { lane: 0, lanes: 1 })?.number).toBe(1711);
  });

  it("does not let a lane pick another lane's Issue", () => {
    // 1711 % 3 === 1, so lane 0 must not see it.
    expect(pickNext([a], [], NOW, { lane: 1, lanes: 3 })?.number).toBe(1711);
    expect(pickNext([a], [], NOW, { lane: 0, lanes: 3 })).toBeNull();
  });
});
