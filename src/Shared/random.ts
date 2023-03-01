import { Imatch } from "./match.interface";

export function Randomize(players: string[], teams: string[]): Imatch[] {
  const matches: Imatch[] = teams.map((team) => {
    return { team, players: [] };
  });

  players.sort(() => 0.5 - Math.random());

  while (players.length > 0) {
    for (let i = 0; i <= matches.length - 1; i++) {
      const player = players.shift();

      if (!player) {
        break;
      }

      matches[i].players.push({
        name: player,
        order: matches[i].players.length,
      });
    }
  }

  return matches;
}
