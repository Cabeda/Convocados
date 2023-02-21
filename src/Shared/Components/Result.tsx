import React from "react";
import { IResult } from "../result.interface";
import TeamPickerUnique from "./TeamPickerUnique.component";

function Result(props: IResult) {
  return <TeamPickerUnique matches={props.matches!}></TeamPickerUnique>;
}

export default Result;
