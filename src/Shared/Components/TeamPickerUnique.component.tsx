import React from "react";
import { IResult } from "../result.interface";
import { makeStyles } from "tss-react/mui";
import Chip from "@mui/material/Chip";
import Grid from "@mui/material/Grid";
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
  };
});

function TeamPickerUnique(props: IResult) {
  const { classes } = useStyles();

  const teams: string[] = Array.from(
    new Set(props.matches.map((team) => team.team))
  );

  return (
    <div className={classes.root}>
      <Grid container spacing={3}>
        {teams.map((team) => {
          const players = props.matches
            .filter((m) => m.team === team)
            .map((m) => m.player);

          return (
            <Grid key={classes.item} className={classes.item} item xs>
              <Paper elevation={3}>
                <div className={classes.section1}>
                  <Typography gutterBottom variant="h4">
                    {team}
                  </Typography>
                </div>
                <div className={classes.section2}>
                  <Divider variant="middle" />
                  {players.map((player) => {
                    return (
                      <Chip
                        key={player}
                        className={classes.chip}
                        label={player}
                      />
                    );
                  })}
                </div>
              </Paper>
            </Grid>
          );
        })}
      </Grid>
    </div>
  );
}

export default TeamPickerUnique;
