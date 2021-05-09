import React, { useEffect, useState } from "react";
import { Randomize } from "./Shared/random";
import "./App.css";
import { GameMode } from "./Shared/GameMode.enum";
import ChipInput from "material-ui-chip-input";
import Result from "./Shared/Components/Result";
import { IResult } from "./Shared/result.interface";
import * as Sentry from "@sentry/browser";
import { Imatch } from "./Shared/match.interface";

Sentry.init({
  dsn: "https://73775aa8e8f44e3c95e4cb9047e1a5b7@sentry.io/2098114",
});

function App() {
  const [players, setPlayers] = useState<string[]>([]);
  const [teams, setTeams] = useState<string[]>([]);
  const [result, setResult] = useState<IResult>({
    matches: [],
    mode: GameMode.TeamPickerUnique,
  });
  const [errorMessage, setErrorMessage] = useState<string>();

  useEffect(() => {
    getresultFromURI();
  }, []);

  const handlePlayerDelete = (chipToDelete: string) => {
    setPlayers(players.filter((player) => player !== chipToDelete));
  };

  const handleTeamDelete = (chipToDelete: string) => {
    setTeams(teams.filter((player) => player !== chipToDelete));
  };

  const handleTeamsChange = (team: string[]) => {
    setTeams([...teams, ...team]);
  };

  const handlePlayersChange = (player: string[]) => {
    setPlayers([...players, ...player]);
  };

  const saveResultToURI = (result: Imatch[], mode: GameMode) => {
    const title = "Team Randomizer Result";
    const url = new URL(window.location.toString());

    url.searchParams.set("result", encodeURI(JSON.stringify(result)));
    url.searchParams.set("mode", mode.toString());

    // eslint-disable-next-line no-restricted-globals
    history.pushState({}, title, url.toString());
  };

  const getresultFromURI = () => {
    let url = new URL(window.location.toString());

    const resultParam = url.searchParams.get("result");
    const modeParam = url.searchParams.get("mode");

    if (resultParam && modeParam) {
      let result: Imatch[] = JSON.parse(decodeURI(resultParam as string));
      let mode: GameMode = JSON.parse(decodeURI(modeParam as string));

      setResult({ matches: result, mode });
    }
  };

  const runRandomize = (mode: GameMode) => {
    try {
      const result = Randomize([...players], [...teams], mode);
      setResult({ matches: result, mode });
      saveResultToURI(result, mode);
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(error.message);
    }
  };

  return (
    <div className="App">
      <header className="App-header">
        <h1 className="App-title">Team Randomizer</h1>
      </header>
      <div>
        <div className="errorMessage">
          {errorMessage && <h3>{errorMessage}</h3>}
        </div>
        <div className="container">
          <div className="cell">
            <h4>Players</h4>
            <ChipInput
              helperText="Insert players above"
              value={players}
              onAdd={(chip: string) => handlePlayersChange([chip])}
              onDelete={(deletedChip: string) =>
                handlePlayerDelete(deletedChip)
              }
              onPaste={(event) => {
                const clipboardText: string = event.clipboardData.getData(
                  "Text"
                );

                event.preventDefault();

                handlePlayersChange(
                  clipboardText.split("\n").filter((t) => t.length > 0)
                );
              }}
            />
          </div>
          <div className="cell">
            <h4>Teams</h4>
            <ChipInput
              helperText="Insert teams above"
              value={teams}
              onAdd={(chip: string) => handleTeamsChange([chip])}
              onDelete={(deletedChip) => handleTeamDelete(deletedChip)}
              onPaste={(event) => {
                const clipboardText: string = event.clipboardData.getData(
                  "Text"
                );

                event.preventDefault();

                handleTeamsChange(
                  clipboardText.split("\n").filter((t) => t.length > 0)
                );
              }}
            />
          </div>
        </div>
        <button
          id="randomizeBtn"
          className="btn"
          onClick={() => runRandomize(GameMode.TeamPickerUnique)}
        >
          <h2>Pick a team</h2>
        </button>
        <button
          id="randomizeBtn"
          className="btn"
          onClick={() => runRandomize(GameMode.TeamPickerShared)}
        >
          <h2>Distribute by teams</h2>
        </button>
        {result.matches.length > 0 && (
          <div>
            <h3>Result</h3>
            <Result matches={result.matches!} mode={result.mode} />
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
