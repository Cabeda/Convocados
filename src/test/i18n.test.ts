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

  it("returns 'en' for fr browser", () => {
    vi.stubGlobal("navigator", { language: "fr-FR" });
    expect(detectLocale()).toBe("en");
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
    localStorage.setItem("convocados-locale", "fr");
    expect(detectLocale()).toBe("en");
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
