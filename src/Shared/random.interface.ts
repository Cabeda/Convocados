import { Imatch } from "./match.interface";

export interface IRandomizer {
    players: string[];
    teams: string[];
    result: Imatch[]
}