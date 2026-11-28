import type { ReactNode } from "react";
import { Box, ButtonBase, SwipeableDrawer, Typography, useMediaQuery } from "@mui/material";
import AssignmentIcon from "@mui/icons-material/Assignment";
import CalendarMonthIcon from "@mui/icons-material/CalendarMonth";
import EmojiEventsIcon from "@mui/icons-material/EmojiEvents";
import EmojiPeopleIcon from "@mui/icons-material/EmojiPeople";
import EventBusyIcon from "@mui/icons-material/EventBusy";
import GroupsIcon from "@mui/icons-material/Groups";
import HistoryIcon from "@mui/icons-material/History";
import NotificationsIcon from "@mui/icons-material/Notifications";
import PaymentsIcon from "@mui/icons-material/Payments";
import PersonOutlinedIcon from "@mui/icons-material/PersonOutlined";
import SettingsIcon from "@mui/icons-material/Settings";
import SportsSoccerIcon from "@mui/icons-material/SportsSoccer";
import { useT } from "~/lib/useT";
import type { TranslationKey } from "~/lib/i18n";
import type { MenuGroup, MenuGroupId, MenuItemId } from "~/lib/eventHeader";
import { tappable } from "./styles";

interface Props {
  open: boolean;
  onClose: () => void;
  groups: MenuGroup[];
  eventId: string;
  owner: { id: string; name: string } | null;
  googleCalendarHref: string;
  onCancelGame: () => void;
  onOpenNotifications: () => void;
}

const GROUP_LABEL: Record<MenuGroupId, TranslationKey> = {
  game: "menuGroupGame", back: "menuGroupBack", you: "menuGroupYou", manage: "menuGroupManage",
};

const LABEL: Record<MenuItemId, TranslationKey> = {
  ics: "downloadIcs", gcal: "addToGoogleCalendar", cancel: "cancelGame",
  history: "menuHistory", seasons: "menuSeasons", attendance: "attendance", log: "activityLog",
  ratings: "ratings", payments: "paymentsPageTitle", watch: "watchScore",
  notifications: "myNotificationsMenu", settings: "eventSettings",
};

const ICON: Record<MenuItemId, ReactNode> = {
  ics: <CalendarMonthIcon />, gcal: <CalendarMonthIcon />, cancel: <EventBusyIcon />,
  history: <HistoryIcon />, seasons: <GroupsIcon />, attendance: <EmojiPeopleIcon />, log: <AssignmentIcon />,
  ratings: <EmojiEventsIcon />, payments: <PaymentsIcon />, watch: <SportsSoccerIcon />,
  notifications: <NotificationsIcon />, settings: <SettingsIcon />,
};

const row = {
  display: "flex", alignItems: "center", justifyContent: "flex-start", gap: 1.5, width: "100%", minHeight: 48, px: 2, py: 1,
  textAlign: "left", fontSize: "1rem", color: "text.primary", textDecoration: "none", ...tappable,
  "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: "-2px" },
} as const;

/** The ⋮ menu as a bottom sheet: groups of 48px rows, closes on Esc, swipe or a tap outside. */
export function EventMenuSheet({ open, onClose, groups, eventId, owner, googleCalendarHref, onCancelGame, onOpenNotifications }: Props) {
  const t = useT();
  const calm = useMediaQuery("(prefers-reduced-motion: reduce)");

  const link = (href: string, external = false) => ({ component: "a", href, onClick: onClose, ...(external ? { target: "_blank", rel: "noopener noreferrer" } : {}) });
  const target = (id: MenuItemId) => {
    const page = (name: string) => link(`/events/${eventId}/${name}`);
    switch (id) {
      case "ics": return link(`/api/events/${eventId}/calendar`);
      case "gcal": return link(googleCalendarHref, true);
      case "history": return page("history");
      case "seasons": return page("seasons");
      case "attendance": return page("attendance");
      case "log": return page("log");
      case "ratings": return page("rankings");
      case "payments": return page("payments");
      case "settings": return page("settings");
      case "watch": return link(`/watch/${eventId}`, true);
      case "cancel": return { onClick: () => { onClose(); onCancelGame(); } };
      case "notifications": return { onClick: () => { onClose(); onOpenNotifications(); } };
    }
  };

  return (
    <SwipeableDrawer
      anchor="bottom" open={open} onOpen={() => {}} onClose={onClose} disableSwipeToOpen
      transitionDuration={calm ? 0 : undefined}
      // Above the install/update banners, so nothing in the sheet is ever covered by them.
      sx={{ zIndex: (th) => th.zIndex.snackbar + 2 }}
      slotProps={{
        paper: {
          role: "dialog", "aria-modal": true, "aria-label": t("moreActions"),
          sx: {
            left: 0, right: 0, mx: "auto", maxWidth: "32rem", maxHeight: "calc(100dvh - 3rem)", overflowY: "auto",
            borderRadius: "20px 20px 0 0", pb: "calc(env(safe-area-inset-bottom) + 8px)",
          },
        },
      }}
    >
      <Box aria-hidden sx={{ width: 36, height: 4, borderRadius: 2, bgcolor: "divider", mx: "auto", mt: 1, mb: 0.5 }} />
      {owner && (
        <ButtonBase component="a" href={`/users/${owner.id}`} onClick={onClose} sx={{ ...row, minHeight: 44, color: "text.secondary" }}>
          <PersonOutlinedIcon />
          <span>{t("managedBy", { name: "" })}<Box component="span" sx={{ fontWeight: 700, color: "text.primary" }}>{owner.name}</Box></span>
        </ButtonBase>
      )}
      {groups.map((g) => (
        <Box key={g.id} role="group" aria-labelledby={`menu-${g.id}`} sx={{ borderTop: 1, borderColor: "divider" }}>
          <Typography id={`menu-${g.id}`} component="h2" sx={{ px: 2, pt: 1.5, pb: 0.5, fontSize: "0.875rem", fontWeight: 600, color: "text.secondary" }}>
            {t(GROUP_LABEL[g.id])}
          </Typography>
          {g.items.map((id) => (
            <ButtonBase key={id} sx={{ ...row, color: id === "cancel" ? "error.main" : "text.primary" }} {...target(id)}>
              {ICON[id]}<span>{t(LABEL[id])}</span>
            </ButtonBase>
          ))}
        </Box>
      ))}
    </SwipeableDrawer>
  );
}
