import React, { useState } from 'react';
import { Imatch } from "./Shared/match.interface";
import "./App.css";

function App() {
  const [players, setPlayers] = useState<String[]>([])
  const [teams, setTeams] = useState<String[]>([])
  const [result, setResult] = useState<Imatch[]>([])

  const handleTeamsChange = (e: React.FormEvent<HTMLTextAreaElement>) => setTeams(e.currentTarget.value.split(","))

  const handlePlayersChange = (e: React.FormEvent<HTMLTextAreaElement>) => setPlayers(e.currentTarget.value.split(","))

  const printResults = (list: Imatch[]): string => {
    let result: string = "";
    for (const item of list) {
      result += "\n" + item.player + " - " + item.team;
    }
    return result;
  }

  const printData = (list: String[]): string[] => {
    return list.map(x => "\n" + x.trim());
  }

  const getItemFromList = (list: string[]) => {
    const item = list.splice(Math.floor(Math.random() * list.length), 1)[0];
    return item.trim();
  }

  const randomize = () => {
    const matches: Imatch[] = [];
    const playersLength = players.length;
    const playersToAdd = JSON.parse(JSON.stringify(players));
    const teamsToAdd = JSON.parse(JSON.stringify(teams));

    for (let i = 0; i < playersLength; i++) {
      const player: string = getItemFromList(playersToAdd);
      const team: string = getItemFromList(teamsToAdd);
      const newTeam: Imatch = { player, team };

      matches.push(newTeam);
    }

      setResult(matches); 
  }

    return (
      <div className="App">
        <header className="App-header">
          <h1 className="App-title">Team Randomizer</h1>
        </header>
        <div>
          <div className="container">
            <label>
              Mode
            </label>
          </div>
          <div className="container">
            <div className="cell">
              <h4>Players</h4>
              <textarea
                id="players"
                placeholder="Insert players separated by a comma here"
                value={printData(players)}
                onChange={handlePlayersChange}
              />
            </div>
            <div className="cell">
              <h4>Teams</h4>
              <textarea
                id="teams"
                placeholder="Insert teams separated by a comma here"
                value={printData(teams)}
                onChange={handleTeamsChange}
              />
            </div>
          </div>
          <button id="randomizeBtn" className="btn" onClick={randomize}>
            <h2>Randomize!!!</h2>
          </button>

          <h4>Result</h4>
          <textarea id="result" value={printResults(result)} />
        </div>
      </div>
    );
}

export default App;
