import { useCallback, useMemo, useState } from "react";
import { createT, detectLocale, setStoredLocale, type Locale, type TFunction } from "./i18n";

export function useT(): TFunction {
  const [locale] = useState<Locale>(() =>
    typeof window === "undefined" ? "en" : detectLocale()
  );
  return useMemo(() => createT(locale), [locale]);
}

export function useLocale(): { locale: Locale; setLocale: (l: Locale) => void; t: TFunction } {
  const [locale, setLocaleState] = useState<Locale>(() =>
    typeof window === "undefined" ? "en" : detectLocale()
  );

  const setLocale = useCallback((l: Locale) => {
    setStoredLocale(l);
    setLocaleState(l);
  }, []);

  const t = useMemo(() => createT(locale), [locale]);
  return { locale, setLocale, t };
}
