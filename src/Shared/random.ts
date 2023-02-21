import { Imatch } from "./match.interface";

export function Randomize(players: any[], teams: any[]): Imatch[] {
  const matches: Imatch[] = [];

  const shuffledPlayers = players.sort((x) => 0.5 - Math.random());
  const shuffledTeams = teams.sort((x) => 0.5 - Math.random());

  for (let i = 0; i < shuffledPlayers.length; i++) {
    const newTeam: Imatch = {
      player: shuffledPlayers[i],
      team: shuffledTeams[
        i - Math.floor(i / shuffledTeams.length) * shuffledTeams.length
      ],
    };
    matches.push(newTeam);
  }

  return matches;
}
