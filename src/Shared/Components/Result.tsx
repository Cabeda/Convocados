import React from "react";
import { IResultMatch } from "../result.interface";
import TeamPickerUnique from "./TeamPickerUnique.component";

function Result(props: IResultMatch) {
  return <TeamPickerUnique {...props}></TeamPickerUnique>;
}

export default Result;
