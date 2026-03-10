import { useState, useEffect } from "react";
import { createT, detectLocale, type Locale, type TFunction } from "./i18n";

export function useT(): TFunction {
  const [locale, setLocale] = useState<Locale>("en");
  useEffect(() => { setLocale(detectLocale()); }, []);
  return createT(locale);
}
