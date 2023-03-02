import React from "react";
import { IResultMatch } from "../result.interface";
import { makeStyles } from "tss-react/mui";
import { Box, Chip, Grid } from "@mui/material";
import Divider from "@mui/material/Divider";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import {
  DragDropContext,
  DropResult,
  ResponderProvided,
  Droppable,
  Draggable,
} from "react-beautiful-dnd";

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
  };
});

function TeamPickerUnique(props: IResultMatch) {
  const { classes } = useStyles();

  function updateResults(
    result: DropResult,
    provided: ResponderProvided
  ): void {
    const { destination, source, draggableId } = result;
    if (!destination) {
      return;
    }

    if (
      destination.droppableId === source.droppableId &&
      destination.index === source.index
    ) {
      return;
    }

    let start = props.matches.find((x) => x.team === source.droppableId);
    let finish = props.matches.find((x) => x.team === destination.droppableId);

    if (!start || !finish)
      throw new Error(
        `No list with these ID's ${source.droppableId} and ${destination.droppableId}`
      );

    const newMatches = props.matches.map((match) => {
      if (match.team === source.droppableId) {
        match.players = match.players.filter((x) => x.name !== draggableId);
      }

      if (match.team === destination.droppableId) {
        const newPlayers = match.players.map((x) => x.name);
        newPlayers.splice(destination.index, 0, draggableId);
        match.players = newPlayers.map((x, i) => {
          return { name: x, order: i };
        });
      }
      return match;
    });

    props.setResult({ matches: newMatches });
  }

  return (
    <DragDropContext onDragEnd={updateResults}>
      <Grid container spacing={3}>
        {props.matches.map((team) => {
          return (
            <Grid key={classes.item} className={classes.item} item xs>
              <Paper elevation={3}>
                <div className={classes.section1}>
                  <Typography gutterBottom variant="h4">
                    {team.team}
                  </Typography>
                </div>
                <Droppable droppableId={team.team}>
                  {(provided) => (
                    <div
                      className={classes.section2}
                      ref={provided.innerRef as any}
                      {...provided.droppableProps}
                    >
                      <Divider variant="middle" />
                      {team.players.map((player) => (
                        <Draggable
                          draggableId={player.name}
                          index={player.order}
                          key={player.name}
                        >
                          {(dragProvided) => (
                            <Box
                              {...dragProvided.draggableProps}
                              {...dragProvided.dragHandleProps}
                              ref={dragProvided.innerRef}
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
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              </Paper>
            </Grid>
          );
        })}
      </Grid>
    </DragDropContext>
  );
}

export default TeamPickerUnique;
