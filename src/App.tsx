import React, { useState, useEffect } from "react";
import { Randomize } from "./Shared/random";
import "./App.css";
import { Chip, Grid2, TextField, Button } from "@mui/material";
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
import { Team, useTeamState } from './hooks/useTeamState';

import Result from "./Shared/Components/Result";
import { Imatch } from "./Shared/match.interface";

function pickRandomNames(): string[] {
  return ["Ninjas", "Gunas"];
}

function App() {
  const { teams, players, setTeams, setPlayers, loading } = useTeamState();
  const [playerInput, setPlayerInput] = useState<string>("");
  const teamNames: string[] = pickRandomNames();
  const [errorMessage, setErrorMessage] = useState<string>();

  const handlePlayerDelete = (chipToDelete: string) => {
    setPlayers(players.filter((player) => player !== chipToDelete));
  };

  const handlePlayersChange = (player: string) => {
    if (player.trim() === "") return;
    setPlayers([...players, player]);
    setPlayerInput("");
  };

  const handlePlayersPasteChange = (player: string[]) => {
    if (player.length === 0) return;
    setPlayers([...players, ...player]);
    setPlayerInput("");
  };

  const runRandomize = () => {
    try {
      const result = Randomize([...players], [...teamNames]);

      // Convert to Team interface format
      const newTeams = result.map(match => ({
        id: match.team,
        name: match.team,
        members: match.players.map(p => p.name)
      }));

      setTeams(newTeams);
      setErrorMessage("");
    } catch (error) {
      if (error instanceof Error) {
        setErrorMessage(error.message);
      }
    }
  };

  // Convert teams to match format for Result component
  const convertTeamsToMatches = (): Imatch[] => {
    return teams.map((team, i) => ({
      team: team.name,
      players: team.members.map((name, order) => ({ name, order: order }))
    }));
  };

  const handleResultChange = (matches: Imatch[]) => {

    const updatedTeams: Team[] = matches.map(match => ({
      id: match.team,
      name: match.team,
      members: match.players.map(p => p.name)
    }));

    setTeams(updatedTeams);


  }

  const theme = useTheme();
  const { mode } = useThemeMode();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const isDarkMode = mode === 'dark';

  if (loading) {
    return (
      <ResponsiveLayout>
        <Box sx={{ textAlign: 'center', padding: 4 }}>
          <Typography variant="h5">Loading...</Typography>
        </Box>
      </ResponsiveLayout>
    );
  }

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
          <Grid2 container className="container" columns={1}>
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
          </Grid2>
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

          {teams.length > 0 && (
            <Box sx={{ mt: 4 }}>
              <Typography variant="h5" component="h3" sx={{ mb: 2 }}>
                Result
              </Typography>
              <Result
                matches={convertTeamsToMatches()}
                setResult={handleResultChange}
              />
            </Box>
          )}
        </Paper>
      </Box>
    </ResponsiveLayout>
  );
}

export default App;
