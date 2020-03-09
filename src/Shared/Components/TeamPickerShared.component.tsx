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

function TeamPickerShared(props: IResult) {
  const classes = useStyles();

  return (
    <div>
      <List
        component="nav"
        className={classes.root}
        aria-label="mailbox folders"
      >
        {props.matches.map(match => {
          return (
            <div>
              <Divider  component="li" />
              <ListItem button key={match.player}>
                <ListItemAvatar>
                  <Avatar>
                    <PersonIcon />
                  </Avatar>
                </ListItemAvatar>
                <ListItemText primary={match.player} secondary={match.team} />
              </ListItem>
            </div>
          );
        })}
        <Divider />
      </List>
    </div>
  );
}

export default TeamPickerShared;
