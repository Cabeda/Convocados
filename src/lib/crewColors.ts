/** Deterministic colour per Crew, so the same Crew reads the same everywhere. */
const CREW_COLORS = ["#5b8def", "#e0629b", "#3fa8a0", "#c9a227", "#9b6bff", "#ef6c50", "#4db6ac", "#f06292"];

export function crewColor(crewId: string): string {
  let hash = 0;
  for (let i = 0; i < crewId.length; i++) hash = (hash * 31 + crewId.charCodeAt(i)) >>> 0;
  return CREW_COLORS[hash % CREW_COLORS.length];
}
