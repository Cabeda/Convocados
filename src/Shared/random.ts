import { Imatch } from "./match.interface";
import { GameMode } from "./GameMode.enum";

function getItemFromList(list: string[]) {
  const item = list.splice(Math.floor(Math.random() * list.length), 1)[0];
  return item.trim();
}

export function Randomize(
  players: any[],
  teams: any[],
  mode: GameMode = GameMode.TeamPickerShared
): Imatch[] {
  const matches: Imatch[] = [];

  if(players.length === 0 || teams.length === 0)
    throw Error("You need at least one player and one team")

  switch (mode) {
    case GameMode.TeamPickerUnique:
        if(teams.length < players.length) {
            throw Error("For this mode you need at least an equal number of teams")
        }
      while (players.length > 0) {
        const player = getItemFromList(players);
        const team = getItemFromList(teams);
        const newTeam: Imatch = { player, team };

        matches.push(newTeam);
      }
      break;
    case GameMode.TeamPickerShared:
      const shuffledPlayers = players.sort(x => 0.5 - Math.random());
      const shuffledTeams = teams.sort(x => 0.5 - Math.random());

      for (let i = 0; i < shuffledPlayers.length; i++) {
        const newTeam: Imatch = {
          player: shuffledPlayers[i],
          team: shuffledTeams[i - (Math.floor(i / shuffledTeams.length) * shuffledTeams.length)]
        };
        matches.push(newTeam);
      }
      break;
    default:
      throw new Error("Game Mode doesn't exist");
  }

  return matches;
}
