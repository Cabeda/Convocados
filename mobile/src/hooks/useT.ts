import { useState, useEffect, useCallback } from "react";
import { createT, detectDeviceLocale, getStoredLocale, setStoredLocale, type Locale, type TFunction } from "~/lib/i18n";

export function useT(): TFunction {
  const [locale, setLocale] = useState<Locale>("en");
  useEffect(() => {
    (async () => {
      const stored = await getStoredLocale();
      setLocale(stored ?? detectDeviceLocale());
    })();
  }, []);
  return createT(locale);
}

export function useLocale(): { locale: Locale; setLocale: (l: Locale) => void; t: TFunction } {
  const [locale, setLocaleState] = useState<Locale>("en");

  useEffect(() => {
    (async () => {
      const stored = await getStoredLocale();
      setLocaleState(stored ?? detectDeviceLocale());
    })();
  }, []);

  const changeLocale = useCallback((l: Locale) => {
    setStoredLocale(l);
    setLocaleState(l);
  }, []);

  return { locale, setLocale: changeLocale, t: createT(locale) };
}
