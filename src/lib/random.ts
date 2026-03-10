export interface Imatch {
  team: string;
  players: Player[];
}

export interface Player {
  order: number;
  name: string;
}

export function Randomize(players: string[], teams: string[]): Imatch[] {
  const matches: Imatch[] = teams.map((team) => ({ team, players: [] }));

  // Fisher-Yates shuffle
  const shuffled = [...players];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  let i = 0;
  for (const player of shuffled) {
    matches[i % matches.length].players.push({
      name: player,
      order: matches[i % matches.length].players.length,
    });
    i++;
  }

  return matches;
}
