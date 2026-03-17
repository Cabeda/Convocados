import { useState, useEffect, useCallback } from "react";
import { createT, detectLocale, setStoredLocale, type Locale, type TFunction } from "./i18n";

export function useT(): TFunction {
  const [locale, setLocale] = useState<Locale>("en");
  useEffect(() => { setLocale(detectLocale()); }, []);
  return createT(locale);
}

export function useLocale(): { locale: Locale; setLocale: (l: Locale) => void; t: TFunction } {
  const [locale, setLocaleState] = useState<Locale>("en");
  useEffect(() => { setLocaleState(detectLocale()); }, []);

  const setLocale = useCallback((l: Locale) => {
    setStoredLocale(l);
    setLocaleState(l);
  }, []);

  return { locale, setLocale, t: createT(locale) };
}
