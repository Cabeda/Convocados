import React, { useState } from "react";
import { Button, Menu, MenuItem, ListItemIcon, ListItemText } from "@mui/material";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import AssignmentIcon from "@mui/icons-material/Assignment";
import EmojiPeopleIcon from "@mui/icons-material/EmojiPeople";
import CalendarMonthIcon from "@mui/icons-material/CalendarMonth";
import { useT } from "~/lib/useT";
import { googleCalendarUrl } from "~/lib/calendar";
import type { EventData } from "./types";

interface Props {
  eventId: string;
  event: EventData;
  gameDate: Date;
}

export function MoreActionsMenu({ eventId, event, gameDate }: Props) {
  const t = useT();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const open = Boolean(anchorEl);

  return (
    <>
      <Button variant="outlined" size="small" startIcon={<MoreVertIcon />}
        onClick={(e) => setAnchorEl(e.currentTarget)}
        aria-label={t("moreActions")}
        sx={{ flexShrink: 0 }}>
        {t("moreActions")}
      </Button>
      <Menu anchorEl={anchorEl} open={open} onClose={() => setAnchorEl(null)}>
        <MenuItem component="a" href={`/events/${eventId}/log`} onClick={() => setAnchorEl(null)}>
          <ListItemIcon><AssignmentIcon fontSize="small" /></ListItemIcon>
          <ListItemText>{t("activityLog")}</ListItemText>
        </MenuItem>
        {(gameDate <= new Date() || event.isRecurring) && (
          <MenuItem component="a" href={`/events/${eventId}/attendance`} onClick={() => setAnchorEl(null)}>
            <ListItemIcon><EmojiPeopleIcon fontSize="small" /></ListItemIcon>
            <ListItemText>{t("attendance")}</ListItemText>
          </MenuItem>
        )}
        <MenuItem component="a" href={`/api/events/${eventId}/calendar`} onClick={() => setAnchorEl(null)}>
          <ListItemIcon><CalendarMonthIcon fontSize="small" /></ListItemIcon>
          <ListItemText>{t("downloadIcs")}</ListItemText>
        </MenuItem>
        <MenuItem component="a"
          href={googleCalendarUrl({
            id: eventId,
            title: event.title,
            location: event.location,
            dateTime: new Date(event.dateTime),
            url: typeof window !== "undefined" ? window.location.href : undefined,
            recurrence: event.isRecurring && event.recurrenceRule
              ? JSON.parse(event.recurrenceRule)
              : undefined,
          })}
          target="_blank" rel="noopener noreferrer"
          onClick={() => setAnchorEl(null)}>
          <ListItemIcon><CalendarMonthIcon fontSize="small" /></ListItemIcon>
          <ListItemText>{t("addToGoogleCalendar")}</ListItemText>
        </MenuItem>
      </Menu>
    </>
  );
}
