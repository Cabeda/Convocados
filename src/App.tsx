import React, { useEffect, useState } from "react";
import { Randomize } from "./Shared/random";
import "./App.css";
import { Chip, Grid, TextField, Button } from "@mui/material";
import { 
  Typography,
  Paper,
  Box,
  useTheme,
  useMediaQuery,
  alpha 
} from '@mui/material';
import ResponsiveLayout from './components/ResponsiveLayout';
import { useThemeMode } from './components/ThemeModeProvider';

import Result from "./Shared/Components/Result";
import { IResult } from "./Shared/result.interface";
import { Imatch } from "./Shared/match.interface";

function pickRandomNames(): string[] {
  return ["Ninjas", "Gunas"];
}

function getResultFromUrl(): IResult {
  let url = new URL(window.location.toString());
  const resultParam = url.searchParams.get("result");

  if (resultParam) {
    const result: Imatch[] = JSON.parse(decodeURI(resultParam as string));
    return { matches: result };
  }
  return { matches: [] };
}
function App() {
  const [playerInput, setPlayerInput] = useState<string>("");
  const [players, setPlayers] = useState<string[]>([]);
  const teams: string[] = pickRandomNames();
  const [result, setResult] = useState<IResult>(() => {
    const result = getResultFromUrl();
    setPlayers(result.matches.flatMap((x) => x.players.map((y) => y.name)));
    return result;
  });
  const [errorMessage, setErrorMessage] = useState<string>();

  useEffect(() => {
    saveResultToURI(result.matches);
  }, [result]);

  const handlePlayerDelete = (chipToDelete: string) => {
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

  const theme = useTheme();
  const { mode } = useThemeMode();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const isDarkMode = mode === 'dark';

  return (
    <ResponsiveLayout>
      <Box sx={{ 
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 4,
        textAlign: 'center',
        transition: 'all 0.3s ease'
      }}>
        <Typography 
          variant={isMobile ? "h4" : "h2"} 
          component="h1" 
          color="primary"
          sx={{ 
            mb: 2,
            fontWeight: 'bold',
            transition: 'color 0.3s ease'
          }}
        >
          Team Randomizer
        </Typography>
        
        <Paper 
          elevation={isDarkMode ? 2 : 0}
          sx={{
            width: '100%',
            padding: isMobile ? theme.spacing(3) : theme.spacing(5),
            borderRadius: theme.shape.borderRadius * 1.5,
            backgroundColor: theme.palette.background.paper,
            transition: 'all 0.3s ease',
            border: isDarkMode ? `1px solid ${alpha(theme.palette.divider, 0.1)}` : 'none'
          }}
        >
          <div className="errorMessage">
            {errorMessage && <h3>{errorMessage}</h3>}
          </div>
          <Grid container className="container" columns={1}>
            <Grid
              item
              xs={1}
              className="cell"
              justifyContent="center"
              alignItems="center"
            >
              <Typography 
                variant="h6" 
                component="h4" 
                color="textPrimary"
                sx={{ mb: 2 }}
              >
                Players
              </Typography>
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
              <Box sx={{ mt: 2, display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {players.map((player) => {
                  return (
                    <Chip
                      key={player}
                      label={player}
                      variant="outlined"
                      color="primary"
                      onDelete={() => handlePlayerDelete(player)}
                      sx={{ margin: '4px' }}
                    />
                  );
                })}
              </Box>
            </Grid>
          </Grid>
          <Button 
            id="randomizeBtn" 
            variant="contained" 
            color="primary"
            size="large"
            onClick={runRandomize}
            sx={{ 
              mt: 3, 
              mb: 2,
              px: 4,
              py: 1.5,
              borderRadius: theme.shape.borderRadius * 1.5 
            }}
          >
            <Typography variant="h6">Distribute by teams</Typography>
          </Button>
          
          {result.matches.length > 0 && (
            <Box sx={{ mt: 4 }}>
              <Typography variant="h5" component="h3" sx={{ mb: 2 }}>
                Result
              </Typography>
              <Result matches={result.matches!} setResult={setResult} />
            </Box>
          )}
        </Paper>
      </Box>
    </ResponsiveLayout>
  );
}

export default App;
