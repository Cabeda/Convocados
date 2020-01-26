import React, { useState } from "react";
import { Imatch } from "./Shared/match.interface";
import { Randomize } from "./Shared/random";
import "./App.css";
import { GameMode } from "./Shared/GameMode.enum";

function App() {
  const [playersField, setPlayersField] = useState<string>();
  const [teamsField, setTeamsField] = useState<string>();
  const [players, setPlayers] = useState<string[]>([]);
  const [teams, setTeams] = useState<string[]>([]);
  const [result, setResult] = useState<Imatch[]>([]);
  const [errorMessage, setErrorMessage] = useState<string>();
  const handleTeamsChange = (e: React.FormEvent<HTMLTextAreaElement>) => {
    setTeamsField(e.currentTarget.value);
    setTeams(e.currentTarget.value ? e.currentTarget.value.split(","): []);
  };

  const handlePlayersChange = (e: React.FormEvent<HTMLTextAreaElement>) => {
  setPlayersField(e.currentTarget.value);
    setPlayers(e.currentTarget.value ? e.currentTarget.value.split(",") : []);
  };

  const printResults = (list: Imatch[]): string => {
    const matches: string[] = list.map(item => item.player + " - " + item.team);

    return list.length
      ? matches.reduce((result, match) => `${result}\n ${match}`)
      : "";
  };

  const runRandomize = (mode: GameMode) => {
    try {
      const result = Randomize([...players], [...teams], mode)
      setResult(result);
      setErrorMessage("")
    } catch (error) {
      setErrorMessage(error.message)
    }
  };

  return (
    <div className="App">
      <header className="App-header">
        <h1 className="App-title">Team Randomizer</h1>
      </header>
      <div>
        <div className="errorMessage">
  {errorMessage && <h3 >{errorMessage}</h3>}
        </div>
        <div className="container">
          <div className="cell">
            <h4>Players</h4>
            <textarea
              id="players"
              placeholder="Insert players separated by a comma here"
              value={playersField}
              onChange={handlePlayersChange}
            />
          </div>
          <div className="cell">
            <h4>Teams</h4>
            <textarea
              id="teams"
              placeholder="Insert teams separated by a comma here"
              value={teamsField}
              onChange={handleTeamsChange}
            />
          </div>
        </div>
        <button id="randomizeBtn" className="btn" onClick={() => runRandomize(GameMode.TeamPickerUnique)}>
          <h2>Pick a team</h2>
        </button>
        <button
          id="randomizeBtn"
          className="btn"
          onClick={() =>runRandomize(GameMode.TeamPickerShared)}>
          <h2>Distribute by teams</h2>
        </button>

        <h3>Result</h3>
        <textarea id="result" value={printResults(result)} />
      </div>
    </div>
  );
}

export default App;
