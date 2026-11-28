import { describe, it, expect } from "vitest";
import en from "~/lib/i18n/en";
import pt from "~/lib/i18n/pt";
import es from "~/lib/i18n/es";
import fr from "~/lib/i18n/fr";
import de from "~/lib/i18n/de";
import it_ from "~/lib/i18n/it";

const LOCALES = { en, pt, es, fr, de, it: it_ } as Record<string, Record<string, string>>;
/** Ranking vocabulary that belongs on the Ranking and Season pages. The "What's at stake" sheet is the one place it may live, and it uses `stakesPreview*` keys. */
const JARGON = /\b(RP|Tier|Crew|Provisional|Elo)\b|Wrap it up/i;
const mine = (m: Record<string, string>) => Object.keys(m).filter((k) => /^(tb|pa)[A-Z]/.test(k));
const english = en as Record<string, string>;

describe("the teams block and the play-again block speak plain words in every language", () => {
  for (const [locale, messages] of Object.entries(LOCALES)) {
    it(`${locale}: no ranking jargon in any tb* or pa* string`, () => {
      expect(mine(messages).filter((k) => JARGON.test(messages[k]))).toEqual([]);
    });
    it(`${locale}: same keys and same placeholders as English`, () => {
      const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      expect(mine(messages).sort()).toEqual(mine(english).sort());
      expect(mine(english).filter((k) => JSON.stringify(placeholders(messages[k])) !== JSON.stringify(placeholders(english[k])))).toEqual([]);
    });
  }

  it("translates the sentences, not just the labels", () => {
    expect(mine(english).length).toBeGreaterThan(25);
    for (const [locale, messages] of Object.entries(LOCALES)) {
      if (locale === "en") continue;
      for (const key of ["tbEarlyBody", "tbNeedTwo", "paManage", "paAsk", "tbReady"]) expect(messages[key], `${locale}.${key}`).not.toBe(english[key]);
    }
  });
});
