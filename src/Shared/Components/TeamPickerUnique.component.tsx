import React from "react";
import { IResult } from "../result.interface";
import { makeStyles } from "@material-ui/core/styles";
import List from "@material-ui/core/List";
import ListItem from "@material-ui/core/ListItem";
import ListItemText from "@material-ui/core/ListItemText";
import Divider from "@material-ui/core/Divider";
import ListItemAvatar from "@material-ui/core/ListItemAvatar";
import Avatar from "@material-ui/core/Avatar";
import PersonIcon from "@material-ui/icons/Person";

const useStyles = makeStyles(theme => ({
  root: {
    width: "100%",
    maxWidth: 360,
    backgroundColor: theme.palette.background.paper
  }
}));

function TeamPickerUnique(props: IResult) {
  const classes = useStyles();

  const teams: string[] = Array.from(
    new Set(props.matches.map(team => team.team))
  );

  return (
    <div>
      {teams.map(team => {
        const players = props.matches
          .filter(m => m.team === team)
          .map(m => m.player)
          
        return (
          <List
            component="nav"
            className={classes.root}
            aria-label="mailbox folders"
          >
            <h1>{team}</h1>
            {players.map(player => {
              return (<div>
                <Divider component="li" />
                <ListItem button key={player}>
                  <ListItemAvatar>
                    <Avatar>
                      <PersonIcon />
                    </Avatar>
                  </ListItemAvatar>
                  <ListItemText primary={player} />
                </ListItem>
              </div>);
            })}
          </List>
        );
      })}
    </div>
  );
}

export default TeamPickerUnique;
