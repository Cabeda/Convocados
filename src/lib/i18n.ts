import en from "./i18n/en";
import pt from "./i18n/pt";
import es from "./i18n/es";
import fr from "./i18n/fr";
import de from "./i18n/de";
import it from "./i18n/it";

export const translations = { en, pt, es, fr, de, it } as const;

export type Locale = keyof typeof translations;
export type TranslationKey = keyof typeof en;

export type TFunction = (key: TranslationKey, params?: Record<string, string | number>) => string;

const SUPPORTED_LOCALES = new Set<string>(Object.keys(translations));

export function createT(locale: Locale): TFunction {
  return (key, params) => {
    const dict = translations[locale] as Record<string, string>;
    let str = dict[key] ?? (translations.en as Record<string, string>)[key] ?? key;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        str = str.replaceAll(`{${k}}`, String(v));
      }
    }
    return str;
  };
}

const LOCALE_KEY = "convocados-locale";

export function detectLocale(): Locale {
  try {
    const stored = localStorage.getItem(LOCALE_KEY);
    if (stored && SUPPORTED_LOCALES.has(stored)) return stored as Locale;
  } catch { /* localStorage unavailable (SSR / Node) */ }
  if (typeof navigator === "undefined") return "en";
  const lang = navigator.language.toLowerCase().split("-")[0];
  if (SUPPORTED_LOCALES.has(lang)) return lang as Locale;
  return "en";
}

export function setStoredLocale(locale: Locale): void {
  try {
    localStorage.setItem(LOCALE_KEY, locale);
  } catch { /* localStorage unavailable (SSR / Node) */ }
}
