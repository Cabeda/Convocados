import en from "./i18n/en";
import pt from "./i18n/pt";
import es from "./i18n/es";
import fr from "./i18n/fr";
import de from "./i18n/de";
import it from "./i18n/it";
import { NativeModules, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

export const translations = { en, pt, es, fr, de, it } as const;

export type Locale = keyof typeof translations;
export type TranslationKey = keyof typeof en;
export type TFunction = (key: TranslationKey, params?: Record<string, string | number>) => string;

const SUPPORTED_LOCALES = new Set<string>(Object.keys(translations));
const LOCALE_KEY = "convocados-locale";

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

export function detectDeviceLocale(): Locale {
  let lang = "en";
  try {
    if (Platform.OS === "ios") {
      lang = NativeModules.SettingsManager?.settings?.AppleLocale
        ?? NativeModules.SettingsManager?.settings?.AppleLanguages?.[0]
        ?? "en";
    } else {
      lang = NativeModules.I18nManager?.localeIdentifier ?? "en";
    }
  } catch { /* fallback */ }
  const code = lang.toLowerCase().split(/[-_]/)[0];
  if (SUPPORTED_LOCALES.has(code)) return code as Locale;
  return "en";
}

export async function getStoredLocale(): Promise<Locale | null> {
  try {
    const stored = await AsyncStorage.getItem(LOCALE_KEY);
    if (stored && SUPPORTED_LOCALES.has(stored)) return stored as Locale;
  } catch { /* ignore */ }
  return null;
}

export async function setStoredLocale(locale: Locale): Promise<void> {
  try {
    await AsyncStorage.setItem(LOCALE_KEY, locale);
  } catch { /* ignore */ }
}
