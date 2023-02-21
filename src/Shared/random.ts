import { Imatch } from "./match.interface";

function getItemFromList(list: string[]): string {
  const item = list.splice(Math.floor(Math.random() * list.length), 1)[0];
  return item.trim();
}

export function Randomize(players: any[], teams: any[]): Imatch[] {
  const matches: Imatch[] = [];

  if (players.length === 0 || teams.length === 0)
    throw Error("You need at least one player and one team");

  if (teams.length < players.length) {
    throw Error("For this mode you need at least an equal number of teams");
  }
  while (players.length > 0) {
    const player = getItemFromList(players);
    const team = getItemFromList(teams);
    const newTeam: Imatch = { player, team };

    matches.push(newTeam);
  }

  return matches;
}
