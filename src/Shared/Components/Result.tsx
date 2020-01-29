import React from "react";
import { GameMode } from "../GameMode.enum";
import { IResult } from "../result.interface";

function Result(props: IResult) {
    const teams: string[] = Array.from( new Set(props.matches.map(team => team.team)))

  switch (props.mode) {
    case GameMode.TeamPickerUnique:
      return (
        <div>
          {props.matches.map(match => {
            return (
              <div key= {match.player}>
                {match.player} - {match.team}
              </div>
            );
          })}
        </div>
      );
    case GameMode.TeamPickerShared:

      return (
        <div>
          {teams.map(team => {
                    return <div key= {team} >{team} - {
                        props.matches.filter(m => m.team === team).map(m => m.player).reduce((players, match) => `${players}, ${match}`)}</div>
                })}
        </div>
      );

    default:
      throw new Error("Unknown mode");
  }
}

export default Result;
