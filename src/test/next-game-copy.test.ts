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
const mine = (m: Record<string, string>) => Object.keys(m).filter((k) => k.startsWith("ng") && k[2] === k[2].toUpperCase() && k[2] !== k[2].toLowerCase());

describe("the next-game block speaks plain words in every language", () => {
  for (const [locale, messages] of Object.entries(LOCALES)) {
    it(`${locale}: no ranking jargon in any ng* string`, () => {
      expect(mine(messages).filter((k) => JARGON.test(messages[k]))).toEqual([]);
    });
    it(`${locale}: every placeholder in English is in the translation`, () => {
      const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      const broken = mine(en as Record<string, string>).filter((k) => JSON.stringify(placeholders(messages[k])) !== JSON.stringify(placeholders((en as Record<string, string>)[k])));
      // Plural variants may drop {left} on purpose ("1 spot left"); nothing else may differ.
      expect(broken.filter((k) => !/One$/.test(k))).toEqual([]);
    });
  }

  it("has the same ng* keys in all six languages, and some of them", () => {
    const keys = (m: Record<string, string>) => mine(m).sort();
    expect(keys(en as Record<string, string>).length).toBeGreaterThan(40);
    for (const messages of Object.values(LOCALES)) expect(keys(messages)).toEqual(keys(en as Record<string, string>));
  });

  it("never leaves an English sentence untranslated in another language", () => {
    const same = ["ngImIn", "ngOpenSpot", "ngResend", "ngYouTag", "ngWhosIn", "ngDismiss"]; // spot-check real words
    for (const [locale, messages] of Object.entries(LOCALES)) {
      if (locale === "en") continue;
      for (const key of same) expect(messages[key], `${locale}.${key}`).not.toBe((en as Record<string, string>)[key]);
    }
  });
});
