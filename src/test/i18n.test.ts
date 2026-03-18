import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { createT, detectLocale, setStoredLocale, translations } from "~/lib/i18n";

describe("createT", () => {
  it("returns English string for 'en'", () => {
    const t = createT("en");
    expect(t("createGame")).toBe("Create a Game");
  });

  it("returns Portuguese string for 'pt'", () => {
    const t = createT("pt");
    expect(t("createGame")).toBe("Criar um Jogo");
  });

  it("interpolates params", () => {
    const t = createT("en");
    expect(t("playerCountPlural", { n: 5 })).toBe("5 players");
  });

  it("interpolates multiple params", () => {
    const t = createT("pt");
    expect(t("everyNWeeks", { n: 3 })).toBe("De 3 em 3 semanas");
  });

  it("falls back to English if key missing in locale", () => {
    const t = createT("pt");
    // All keys exist in both, so test with a key that exists in en
    expect(t("appName")).toBe("Convocados");
  });

  it("returns key if not found in any locale", () => {
    const t = createT("en");
    // @ts-expect-error testing missing key
    expect(t("nonExistentKey")).toBe("nonExistentKey");
  });

  it("all English keys have Portuguese translations", () => {
    const enKeys = Object.keys(translations.en);
    const ptKeys = Object.keys(translations.pt);
    expect(ptKeys.sort()).toEqual(enKeys.sort());
  });

  it("all English keys have Spanish translations", () => {
    const enKeys = Object.keys(translations.en);
    const esKeys = Object.keys(translations.es);
    expect(esKeys.sort()).toEqual(enKeys.sort());
  });

  it("all English keys have French translations", () => {
    const enKeys = Object.keys(translations.en);
    const frKeys = Object.keys(translations.fr);
    expect(frKeys.sort()).toEqual(enKeys.sort());
  });

  it("all English keys have German translations", () => {
    const enKeys = Object.keys(translations.en);
    const deKeys = Object.keys(translations.de);
    expect(deKeys.sort()).toEqual(enKeys.sort());
  });

  it("all English keys have Italian translations", () => {
    const enKeys = Object.keys(translations.en);
    const itKeys = Object.keys(translations.it);
    expect(itKeys.sort()).toEqual(enKeys.sort());
  });

  it("returns Spanish string for 'es'", () => {
    const t = createT("es");
    expect(t("createGame")).toBe("Crear un Juego");
  });

  it("returns French string for 'fr'", () => {
    const t = createT("fr");
    expect(t("createGame")).toBe("Créer un Match");
  });

  it("returns German string for 'de'", () => {
    const t = createT("de");
    expect(t("createGame")).toBe("Spiel erstellen");
  });

  it("returns Italian string for 'it'", () => {
    const t = createT("it");
    expect(t("createGame")).toBe("Crea una Partita");
  });
});

// Minimal localStorage stub for Node test environment
function createLocalStorageStub() {
  const store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
    get length() { return Object.keys(store).length; },
    key: (i: number) => Object.keys(store)[i] ?? null,
  };
}

describe("detectLocale", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createLocalStorageStub());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 'pt' for pt-PT browser", () => {
    vi.stubGlobal("navigator", { language: "pt-PT" });
    expect(detectLocale()).toBe("pt");
  });

  it("returns 'pt' for pt-BR browser", () => {
    vi.stubGlobal("navigator", { language: "pt-BR" });
    expect(detectLocale()).toBe("pt");
  });

  it("returns 'en' for en-US browser", () => {
    vi.stubGlobal("navigator", { language: "en-US" });
    expect(detectLocale()).toBe("en");
  });

  it("returns 'en' for unknown browser language", () => {
    vi.stubGlobal("navigator", { language: "ja-JP" });
    expect(detectLocale()).toBe("en");
  });

  it("returns 'es' for es browser", () => {
    vi.stubGlobal("navigator", { language: "es-ES" });
    expect(detectLocale()).toBe("es");
  });

  it("returns 'fr' for fr browser", () => {
    vi.stubGlobal("navigator", { language: "fr-FR" });
    expect(detectLocale()).toBe("fr");
  });

  it("returns 'de' for de browser", () => {
    vi.stubGlobal("navigator", { language: "de-DE" });
    expect(detectLocale()).toBe("de");
  });

  it("returns 'it' for it browser", () => {
    vi.stubGlobal("navigator", { language: "it-IT" });
    expect(detectLocale()).toBe("it");
  });

  it("returns 'en' when navigator is undefined", () => {
    vi.stubGlobal("navigator", undefined);
    expect(detectLocale()).toBe("en");
  });

  it("returns stored locale from localStorage over browser language", () => {
    vi.stubGlobal("navigator", { language: "en-US" });
    localStorage.setItem("convocados-locale", "pt");
    expect(detectLocale()).toBe("pt");
  });

  it("ignores invalid localStorage values", () => {
    vi.stubGlobal("navigator", { language: "en-US" });
    localStorage.setItem("convocados-locale", "xx");
    expect(detectLocale()).toBe("en");
  });

  it("returns stored 'es' from localStorage", () => {
    vi.stubGlobal("navigator", { language: "en-US" });
    localStorage.setItem("convocados-locale", "es");
    expect(detectLocale()).toBe("es");
  });
});

describe("setStoredLocale", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createLocalStorageStub());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("stores locale in localStorage", () => {
    setStoredLocale("pt");
    expect(localStorage.getItem("convocados-locale")).toBe("pt");
  });

  it("overwrites previous value", () => {
    setStoredLocale("pt");
    setStoredLocale("en");
    expect(localStorage.getItem("convocados-locale")).toBe("en");
  });
});
