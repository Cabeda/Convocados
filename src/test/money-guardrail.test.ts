import { describe, it, expect } from "vitest";
import path from "node:path";
import { ESLint } from "eslint";

/**
 * The money guardrail: money renders through `src/lib/money.ts` and nowhere else.
 *
 * This is a mechanical rule (a banned API and a banned call shape), so it gets a
 * deterministic check rather than a line in CODING_STANDARDS. It exists because
 * three consecutive review rounds found a private money formatter that tests had
 * not: `Intl.NumberFormat({ style: "currency" })` in two components, a
 * hand-rolled symbol map in a third, `toFixed(2)` in a push body and a cron
 * notification, and a `formatMoney` call that forgot its currency.
 *
 * This test pins the guardrail itself. Its absence is the failure mode: a rule
 * deleted or de-scoped by a later `eslint.config.js` edit would otherwise go
 * unnoticed until the next reviewer caught the same class of bug by hand.
 */
const eslint = new ESLint();
const abs = (p: string) => path.join(process.cwd(), p);

/** Rule ids the config reports for `code` as if it lived at `filePath`. */
async function ruleIds(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: abs(filePath) });
  return result.messages.map((m) => m.ruleId ?? "");
}

const MONEY_RULE = "no-restricted-syntax";

describe("the money guardrail rejects a private formatter", () => {
  it("rejects Intl.NumberFormat, the private currency formatter a reviewer found twice", async () => {
    const ids = await ruleIds(
      `export const f = (p: number, c: string) => new Intl.NumberFormat(undefined, { style: "currency", currency: c }).format(p);`,
      "src/components/Probe.ts",
    );
    expect(ids).toContain(MONEY_RULE);
  });

  it("rejects toFixed(2), the money shape a reviewer found in a push body and a cron", async () => {
    const ids = await ruleIds(
      `export const label = (amount: number) => \`You owe \${amount.toFixed(2)}\`;`,
      "src/lib/probe.server.ts",
    );
    expect(ids).toContain(MONEY_RULE);
  });

  it("allows toFixed at other precisions, which is rating maths and coordinates, not money", async () => {
    const ids = await ruleIds(
      `export const a = (e: number) => e.toFixed(3);\nexport const b = (lat: number) => lat.toFixed(6);\nexport const c = (pct: number) => pct.toFixed(0);`,
      "src/lib/probe.server.ts",
    );
    expect(ids).not.toContain(MONEY_RULE);
  });

  it("rejects a currency-symbol literal, the hand-rolled symbol map a reviewer found", async () => {
    const ids = await ruleIds(
      `export const SYMBOLS: Record<string, string> = { EUR: "€" };`,
      "src/components/Probe.ts",
    );
    expect(ids).toContain(MONEY_RULE);
  });

  it("rejects a symbol inside a template literal, the shape the push body actually used", async () => {
    // A template literal's text is a TemplateElement, not a Literal — the shape
    // that shipped as `You owe €${amount.toFixed(2)}` in a push notification.
    const ids = await ruleIds(
      "export const push = (a: number) => `You owe €${a} — tap to pay`;",
      "src/lib/probe.server.ts",
    );
    expect(ids).toContain(MONEY_RULE);
  });
});

describe("the money guardrail leaves the one formatter and its tests alone", () => {
  it("allows money.ts to name the symbols and call toFixed(2)", async () => {
    const ids = await ruleIds(
      `const SYMBOLS: Record<string, string> = { EUR: "€" };\nexport const f = (c: number) => \`\${(c / 100).toFixed(2)}\${SYMBOLS.EUR}\`;`,
      "src/lib/money.ts",
    );
    expect(ids).not.toContain(MONEY_RULE);
  });

  it("allows a test to assert the exact rendered string", async () => {
    const ids = await ruleIds(
      `import { expect } from "vitest";\nexpect(f(5000)).toBe("50.00€");`,
      "src/test/money.test.ts",
    );
    expect(ids).not.toContain(MONEY_RULE);
  });

  it("allows a transport format that is not a display, with its reason recorded", async () => {
    const ids = await ruleIds(
      `export const url = (a: number) => new URLSearchParams({ amount: a.toFixed(2) }); // eslint-disable-line no-restricted-syntax -- provider wire format, not a display`,
      "src/lib/probe.server.ts",
    );
    expect(ids).not.toContain(MONEY_RULE);
  });
});
