import React from 'react';
import {GameMode} from '../GameMode.enum'
import { IResult } from '../result.interface';

function Result(props:IResult) {
    switch (props.mode) {
        case GameMode.TeamPickerUnique:
            return (
            
                <div>
                {props.matches.map(match => {
                    return <div>{match.player} - {match.team}</div>
                })}
                </div>
        );
        case GameMode.TeamPickerShared:
            return (
            
                <div>
                {props.matches.map(match => {
                    return <div>{match.player} - {match.team}</div>
                })}
                </div>
        );
    
        default:
            throw "Unknown mode";
            
    }
}

export default Result;