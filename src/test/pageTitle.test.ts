import { describe, it, expect } from "vitest";
import { pageTitle } from "~/lib/pageTitle";
import { createT } from "~/lib/i18n";

const t = createT("en");
const base = { title: "Ninjas", date: "Fri 4 Dec" };

describe("pageTitle", () => {
  it("says the result first after a game the viewer played, with their score first", () => {
    expect(pageTitle({ ...base, result: { outcome: "won", mine: 7, theirs: 6 } }, t)).toBe("Won 7–6 · Ninjas");
    expect(pageTitle({ ...base, result: { outcome: "lost", mine: 2, theirs: 5 } }, t)).toBe("Lost 2–5 · Ninjas");
    expect(pageTitle({ ...base, result: { outcome: "draw", mine: 3, theirs: 3 } }, t)).toBe("Draw 3–3 · Ninjas");
  });

  it("says the next day otherwise", () => {
    expect(pageTitle({ ...base, result: null }, t)).toBe("Ninjas · Fri 4 Dec");
  });

  it("is written in the viewer's language", () => {
    expect(pageTitle({ ...base, result: { outcome: "won", mine: 1, theirs: 0 } }, createT("pt"))).toBe("Vitória 1–0 · Ninjas");
  });
});
