import React from "react";
import { GameMode } from "../GameMode.enum";
import { IResult } from "../result.interface";
import TeamPickerShared from "./TeamPickerShared.component";
import TeamPickerUnique from "./TeamPickerUnique.component";

function Result(props: IResult) {

  switch (props.mode) {
    case GameMode.TeamPickerUnique:
      return (
        <TeamPickerShared
          matches={props.matches!}
          mode={props.mode}
        ></TeamPickerShared>
      );
    case GameMode.TeamPickerShared:
      return (
        <TeamPickerUnique
        matches={props.matches!}
        mode={props.mode}
      ></TeamPickerUnique>
      );

    default:
      throw new Error("Unknown mode");
  }
}

export default Result;
