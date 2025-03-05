import { Imatch } from "./match.interface";

export interface IResult {
  matches: Imatch[];
}

export interface IResultMatch {
  matches: Imatch[];
  setResult: (matches: Imatch[]) => void;
}
