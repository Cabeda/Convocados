import { Imatch } from "./match.interface";
import { GameMode } from "./GameMode.enum";

export interface IResult {
  matches: Imatch[];
  mode: GameMode;
}
