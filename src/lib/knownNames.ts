const KNOWN_NAMES_KEY = "known_names";
const QJ_NAME_KEY = "qj_name";
const MAX_KNOWN_NAMES = 20;

export function getKnownNames(): string[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const stored = localStorage.getItem(KNOWN_NAMES_KEY);
    if (!stored) return [];
    return JSON.parse(stored) as string[];
  } catch {
    return [];
  }
}

export function addKnownName(name: string): void {
  if (typeof localStorage === "undefined") return;
  const trimmed = name.trim();
  if (!trimmed) return;
  
  const names = getKnownNames();
  const filtered = names.filter((n) => n.toLowerCase() !== trimmed.toLowerCase());
  const updated = [trimmed, ...filtered].slice(0, MAX_KNOWN_NAMES);
  localStorage.setItem(KNOWN_NAMES_KEY, JSON.stringify(updated));
}

export function getQjName(): string {
  if (typeof localStorage === "undefined") return "";
  return localStorage.getItem(QJ_NAME_KEY) ?? "";
}

export function setQjName(name: string): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(QJ_NAME_KEY, name);
}