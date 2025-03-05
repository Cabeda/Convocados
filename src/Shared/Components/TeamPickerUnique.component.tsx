import React, { useState } from "react";
import { IResultMatch } from "../result.interface";
import { makeStyles } from "tss-react/mui";
import { Box, Chip, Grid2 } from "@mui/material";
import Divider from "@mui/material/Divider";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";

const useStyles = makeStyles()((theme) => {
  return {
    root: {
      flexGrow: 1,
      backgroundColor: theme.palette.background.paper,
    },
    item: {
      margin: "auto",
      maxWidth: 500,
    },
    chip: {
      margin: theme.spacing(0.5),
    },
    section1: {
      margin: theme.spacing(3, 2),
    },
    section2: {
      margin: theme.spacing(2),
    },
    dropArea: {
      minHeight: '50px',
      padding: theme.spacing(1),
      border: '2px dashed transparent',
    },
    dropAreaActive: {
      border: `2px dashed ${theme.palette.primary.main}`,
      backgroundColor: theme.palette.action.hover,
    },
    playerItem: {
      cursor: 'grab',
      display: 'inline-block',
    }
  };
});

function TeamPickerUnique(props: IResultMatch) {
  const { classes } = useStyles();
  const [draggedPlayer, setDraggedPlayer] = useState<{ name: string, team: string } | null>(null);
  const [activeDropZone, setActiveDropZone] = useState<string | null>(null);

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, playerName: string, teamName: string) => {
    setDraggedPlayer({ name: playerName, team: teamName });
    e.dataTransfer.setData('text/plain', playerName);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>, teamName: string) => {
    e.preventDefault();
    setActiveDropZone(teamName);
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDragLeave = () => {
    setActiveDropZone(null);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>, destinationTeam: string) => {
    e.preventDefault();
    setActiveDropZone(null);

    if (!draggedPlayer) return;

    const { name: playerName, team: sourceTeam } = draggedPlayer;

    if (sourceTeam === destinationTeam) return;

    const newMatches = props.matches.map(match => {
      if (match.team === sourceTeam) {
        match.players = match.players.filter(p => p.name !== playerName);
      }

      if (match.team === destinationTeam) {
        const newPlayers = [...match.players, { name: playerName, order: match.players.length }];
        match.players = newPlayers.map((player, index) => ({
          name: player.name,
          order: index
        }));
      }

      return match;
    });

    props.setResult(newMatches);
    setDraggedPlayer(null);
  };

  const handleDragEnd = () => {
    setDraggedPlayer(null);
    setActiveDropZone(null);
  };

  return (
    <Grid2 container spacing={3}>
      {props.matches.map((team) => {
        const isActive = activeDropZone === team.team;
        return (
          <Grid2 key={team.team} className={classes.item}>
            <Paper elevation={3}>
              <div className={classes.section1}>
                <Typography gutterBottom variant="h4">
                  {team.team}
                </Typography>
              </div>
              <div
                className={`${classes.section2} ${classes.dropArea} ${isActive ? classes.dropAreaActive : ''}`}
                onDragOver={(e) => handleDragOver(e, team.team)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, team.team)}
              >
                <Divider variant="middle" />
                {team.players.map((player) => (
                  <Box
                    key={player.name}
                    className={classes.playerItem}
                    draggable
                    onDragStart={(e) => handleDragStart(e, player.name, team.team)}
                    onDragEnd={handleDragEnd}
                  >
                    <Chip
                      key={player.name}
                      className={classes.chip}
                      label={player.name}
                      sx={{
                        minWidth: "50%",
                      }}
                    />
                  </Box>
                ))}
              </div>
            </Paper>
          </Grid2>
        );
      })}
    </Grid2>
  );
}

export default TeamPickerUnique;
