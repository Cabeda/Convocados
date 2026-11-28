import { describe, it, expect } from "vitest";
import en from "~/lib/i18n/en";
import pt from "~/lib/i18n/pt";
import es from "~/lib/i18n/es";
import fr from "~/lib/i18n/fr";
import de from "~/lib/i18n/de";
import it_ from "~/lib/i18n/it";

const LOCALES = { en, pt, es, fr, de, it: it_ } as Record<string, Record<string, string>>;
/** Ranking vocabulary that belongs on the Ranking and Season pages, never on the event page. */
const JARGON = /\b(RP|Tier|Crew|Provisional|Elo)\b|Wrap it up/i;

describe("the recap speaks plain words in every language", () => {
  for (const [locale, messages] of Object.entries(LOCALES)) {
    it(`${locale}: no ranking jargon in any recap* string`, () => {
      const offenders = Object.entries(messages)
        .filter(([key, value]) => key.startsWith("recap") && JARGON.test(value))
        .map(([key]) => key);
      expect(offenders).toEqual([]);
    });
  }

  it("has the same recap keys in all six languages", () => {
    const keys = (m: Record<string, string>) => Object.keys(m).filter((k) => k.startsWith("recap")).sort();
    for (const messages of Object.values(LOCALES)) expect(keys(messages)).toEqual(keys(en as Record<string, string>));
  });

  it("never uses the numeric shorthand for how many paid", () => {
    for (const [locale, messages] of Object.entries(LOCALES)) {
      expect(messages.recapLinkPaymentsSub, locale).not.toMatch(/\{paid\}\s*\/\s*\{total\}/);
    }
  });
});
