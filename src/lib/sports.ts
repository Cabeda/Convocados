export interface SportPreset {
  id: string;
  labelKey: string; // i18n key
  defaultMaxPlayers: number;
  defaultDurationMinutes: number;
}

export const SPORT_PRESETS: SportPreset[] = [
  { id: "football-5v5", labelKey: "sportFootball5v5", defaultMaxPlayers: 10, defaultDurationMinutes: 60 },
  { id: "football-7v7", labelKey: "sportFootball7v7", defaultMaxPlayers: 14, defaultDurationMinutes: 70 },
  { id: "football-11v11", labelKey: "sportFootball11v11", defaultMaxPlayers: 22, defaultDurationMinutes: 90 },
  { id: "futsal", labelKey: "sportFutsal", defaultMaxPlayers: 10, defaultDurationMinutes: 60 },
  { id: "basketball", labelKey: "sportBasketball", defaultMaxPlayers: 10, defaultDurationMinutes: 48 },
  { id: "volleyball", labelKey: "sportVolleyball", defaultMaxPlayers: 12, defaultDurationMinutes: 60 },
  { id: "tennis-singles", labelKey: "sportTennisSingles", defaultMaxPlayers: 2, defaultDurationMinutes: 90 },
  { id: "tennis-doubles", labelKey: "sportTennisDoubles", defaultMaxPlayers: 4, defaultDurationMinutes: 90 },
  { id: "padel", labelKey: "sportPadel", defaultMaxPlayers: 4, defaultDurationMinutes: 90 },
  { id: "other", labelKey: "sportOther", defaultMaxPlayers: 10, defaultDurationMinutes: 60 },
];

export function getSportPreset(sportId: string): SportPreset {
  return SPORT_PRESETS.find((s) => s.id === sportId) ?? SPORT_PRESETS[0];
}

export function getDefaultMaxPlayers(sportId: string): number {
  return getSportPreset(sportId).defaultMaxPlayers;
}

export function getDefaultDurationMinutes(sportId: string): number {
  return getSportPreset(sportId).defaultDurationMinutes;
}
