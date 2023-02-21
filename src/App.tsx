import React, { useEffect, useState } from "react";
import { Randomize } from "./Shared/random";
import "./App.css";
import { Chip, Grid, TextField } from "@mui/material";

import Result from "./Shared/Components/Result";
import { IResult } from "./Shared/result.interface";
import { Imatch } from "./Shared/match.interface";

function pickRandomNames(): string[] {
  return ["Ninjas", "Gunas"];
}
function App() {
  const [playerInput, setPlayerInput] = useState<string>("");
  const [players, setPlayers] = useState<string[]>([]);
  const teams: string[] = pickRandomNames();
  const [result, setResult] = useState<IResult>({
    matches: [],
  });
  const [errorMessage, setErrorMessage] = useState<string>();

  useEffect(() => {
    let url = new URL(window.location.toString());
    const resultParam = url.searchParams.get("result");
    const modeParam = url.searchParams.get("mode");

    if (resultParam && modeParam) {
      let result: Imatch[] = JSON.parse(decodeURI(resultParam as string));

      setPlayers(result.flatMap((x) => x.player));
      setResult({ matches: result });
    }
  }, []);

  const handlePlayerDelete = (chipToDelete: string) => {
    console.log(chipToDelete);

    setPlayers(players.filter((player) => player !== chipToDelete));
  };

  const handlePlayersChange = (player: string) => {
    setPlayers([...players, player]);
    setPlayerInput("");
  };

  const handlePlayersPasteChange = (player: string[]) => {
    setPlayers([...players, ...player]);
    setPlayerInput("");
  };

  const saveResultToURI = (result: Imatch[]) => {
    const title = "Team Randomizer Result";
    const url = new URL(window.location.toString());

    url.searchParams.set("result", encodeURI(JSON.stringify(result)));

    // eslint-disable-next-line no-restricted-globals
    history.pushState({}, title, url.toString());
  };

  const runRandomize = () => {
    try {
      const result = Randomize([...players], [...teams]);
      setResult({ matches: result });
      saveResultToURI(result);
      setErrorMessage("");
    } catch (error) {
      if (error instanceof Error) {
        setErrorMessage(error.message);
      }
    }
  };

  return (
    <div className="App">
      <header className="App-header">
        <h1 className="App-title">Team Randomizer</h1>
      </header>
      <div className="errorMessage">
        {errorMessage && <h3>{errorMessage}</h3>}
      </div>
      <Grid container className="container" columns={1}>
        <Grid
          xs={1}
          className="cell"
          justifyContent="center"
          alignItems="center"
        >
          <h4>Players</h4>
          <TextField
            id="outlined-basic"
            variant="outlined"
            autoFocus
            helperText="Insert players above"
            fullWidth={true}
            value={playerInput}
            onChange={(e) => setPlayerInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handlePlayersChange(playerInput);
            }}
            onPaste={(event) => {
              const clipboardText: string = event.clipboardData.getData("Text");
              event.preventDefault();

              const players = clipboardText
                .split("\n")
                .filter((t) => t.length > 0);

              handlePlayersPasteChange(players);
            }}
          />
          {players.map((player) => {
            return (
              <Chip
                key={player}
                label={player}
                variant="outlined"
                onDelete={() => handlePlayerDelete(player)}
              />
            );
          })}
        </Grid>
      </Grid>
      <button id="randomizeBtn" className="btn" onClick={runRandomize}>
        <h2>Distribute by teams</h2>
      </button>
      {result.matches.length > 0 && (
        <div>
          <h3>Result</h3>
          <Result matches={result.matches!} />
        </div>
      )}
    </div>
  );
}

export default App;
