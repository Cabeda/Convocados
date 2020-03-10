import React from "react";
import { IResult } from "../result.interface";
import { makeStyles } from "@material-ui/core/styles";
import Avatar from "@material-ui/core/Avatar";
import Grid from "@material-ui/core/Grid";
import Paper from "@material-ui/core/Paper";
import ListItemText from "@material-ui/core/ListItemText";

const useStyles = makeStyles(theme => ({
  root: {
    flexGrow: 1,
    backgroundColor: theme.palette.background.paper
  },
  paper: {
    padding: theme.spacing(2),
    margin: "auto",
    maxWidth: 500
  }
}));

function TeamPickerShared(props: IResult) {
  const classes = useStyles();

  return (
    <div className={classes.root}>
      {props.matches.map(match => {
        return (
          <Paper className={classes.paper}>
            <Grid container spacing={2}>
              <Grid item>
                <Avatar>{match.team.slice(0, 1).toUpperCase()}</Avatar>
              </Grid>
              <Grid item xs>
                <ListItemText primary={match.player} secondary={match.team} />
              </Grid>
            </Grid>
          </Paper>
        );
      })}
    </div>
  );
}

export default TeamPickerShared;
