export function normalizeForMatch(str: string): string {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export function matchesWithName(name: string, query: string): boolean {
  return normalizeForMatch(name).includes(normalizeForMatch(query));
}