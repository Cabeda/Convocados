import React, { useState, useEffect } from "react";
import { Randomize } from "./Shared/random";
import "./App.css";
import { 
  Chip, 
  TextField, 
  Button,
  Typography,
  Paper,
  Box,
  useTheme,
  useMediaQuery,
  alpha,
  Container,
  Stack,
  Divider,
  IconButton,
  InputAdornment
} from '@mui/material';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import ShuffleIcon from '@mui/icons-material/Shuffle';
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
        <Box sx={{ 
          display: 'flex', 
          justifyContent: 'center', 
          alignItems: 'center', 
          height: '100vh' 
        }}>
          <Typography variant="h5">Loading...</Typography>
        </Box>
      </ResponsiveLayout>
    );
  }

  return (
    <ResponsiveLayout>
      <Container maxWidth="md" sx={{ py: 4 }}>
        <Stack spacing={4}>

          <Paper
            elevation={isDarkMode ? 3 : 1}
            sx={{
              borderRadius: 2,
              overflow: 'hidden',
              backgroundColor: theme.palette.background.paper,
              transition: theme.transitions.create(['box-shadow', 'background-color']),
              border: isDarkMode ? `1px solid ${alpha(theme.palette.divider, 0.1)}` : 'none'
            }}
          >
            <Box sx={{ p: { xs: 2, sm: 3, md: 4 } }}>
              {errorMessage && (
                <Box 
                  sx={{ 
                    p: 2, 
                    mb: 3, 
                    borderRadius: 1, 
                    backgroundColor: alpha(theme.palette.error.main, 0.1),
                    border: `1px solid ${alpha(theme.palette.error.main, 0.2)}` 
                  }}
                >
                  <Typography color="error" variant="body1">{errorMessage}</Typography>
                </Box>
              )}
              
              <Typography
                variant="h5"
                component="h2"
                color="textPrimary"
                sx={{ mb: 2, fontWeight: 500 }}
              >
                Players
              </Typography>
              
              <TextField
                variant="outlined"
                autoFocus
                placeholder="Add player name"
                helperText="Press Enter to add or paste a list of names"
                fullWidth
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
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton 
                        edge="end"
                        color="primary"
                        onClick={() => handlePlayersChange(playerInput)}
                        disabled={!playerInput.trim()}
                      >
                        <PersonAddIcon />
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
                sx={{ mb: 2 }}
              />
              
              {players.length > 0 && (
                <Paper
                  variant="outlined"
                  sx={{
                    p: 2,
                    mt: 2,
                    mb: 3,
                    borderRadius: 1,
                    backgroundColor: alpha(theme.palette.background.default, 0.6),
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 1
                  }}
                >
                  {players.map((player) => (
                    <Chip
                      key={player}
                      label={player}
                      variant="filled"
                      color="primary"
                      onDelete={() => handlePlayerDelete(player)}
                      sx={{ m: 0.5 }}
                    />
                  ))}
                </Paper>
              )}
              
              <Box sx={{ display: 'flex', justifyContent: 'center', mt: 3 }}>
                <Button
                  id="randomizeBtn"
                  variant="contained"
                  color="primary"
                  size="large"
                  onClick={runRandomize}
                  disabled={players.length < 2}
                  startIcon={<ShuffleIcon />}
                  sx={{
                    px: 4,
                    py: 1.5,
                    borderRadius: 2,
                    textTransform: 'none',
                    fontWeight: 600,
                    boxShadow: theme.shadows[3],
                  }}
                >
                  Distribute by teams
                </Button>
              </Box>

              {teams.length > 0 && (
                <>
                  <Divider sx={{ my: 4 }} />
                  <Typography 
                    variant="h5" 
                    component="h2" 
                    sx={{ mb: 3, fontWeight: 500 }}
                  >
                    Teams
                  </Typography>
                  <Result
                    matches={convertTeamsToMatches()}
                    setResult={handleResultChange}
                  />
                </>
              )}
            </Box>
          </Paper>
        </Stack>
      </Container>
    </ResponsiveLayout>
  );
}

export default App;
