import React from "react";
import { IResult } from "../result.interface";
import { makeStyles } from "@material-ui/core/styles";
import Chip from "@material-ui/core/Chip";
import Grid from "@material-ui/core/Grid";
import Divider from "@material-ui/core/Divider";
import Typography from "@material-ui/core/Typography";
import Paper from "@material-ui/core/Paper";

const useStyles = makeStyles(theme => ({
  root: {
    flexGrow: 1,
    backgroundColor: theme.palette.background.paper,
    margin: "auto"
  },
  item: {
    maxWidth:500
  },
  chip: {
    margin: theme.spacing(0.5)
  },
  section1: {
    margin: theme.spacing(3, 2)
  },
  section2: {
    margin: theme.spacing(2)
  }
}));

function TeamPickerUnique(props: IResult) {
  const classes = useStyles();

  const teams: string[] = Array.from(
    new Set(props.matches.map(team => team.team))
  );

  return (
    <div className={classes.root}>
      <Grid container spacing={3}>
        {teams.map(team => {
          const players = props.matches
            .filter(m => m.team === team)
            .map(m => m.player);

          return (
            <Grid className={classes.item} item xs>
              <Paper elevation={3}>
                <div className={classes.section1}>
                  <Typography gutterBottom variant="h4">
                    {team}
                  </Typography>
                </div>
                <div className={classes.section2}>
                  <Divider variant="middle" />
                  {players.map(player => {
                    return (
                      <div>
                        <Chip className={classes.chip} label={player} />
                      </div>
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
