import type { ReactNode } from "react";
import type { Theme } from "@mui/material/styles";
import { Box, ButtonBase, IconButton, SwipeableDrawer, Typography, useMediaQuery, useTheme } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import AssignmentIcon from "@mui/icons-material/Assignment";
import CalendarMonthIcon from "@mui/icons-material/CalendarMonth";
import EmojiEventsIcon from "@mui/icons-material/EmojiEvents";
import EmojiPeopleIcon from "@mui/icons-material/EmojiPeople";
import EventBusyIcon from "@mui/icons-material/EventBusy";
import GroupsIcon from "@mui/icons-material/Groups";
import FormatListNumberedIcon from "@mui/icons-material/FormatListNumbered";
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
  /** The id of the sheet, for the trigger's aria-controls. */
  menuId: string;
  owner: { id: string; name: string } | null;
  googleCalendarHref: string;
  onCancelGame: () => void;
  onOpenNotifications: () => void;
}

const GROUP_LABEL: Record<MenuGroupId, TranslationKey> = {
  game: "menuGroupGame", back: "menuGroupBack", you: "menuGroupYou", manage: "menuGroupManage",
};

const LABEL: Record<MenuItemId, TranslationKey> = {
  ics: "menuCalendarFile", gcal: "addToGoogleCalendar", cancel: "cancelGame",
  history: "menuHistory", seasons: "menuSeasons", attendance: "attendance", log: "activityLog",
  ratings: "menuRatings", payments: "paymentsPageTitle", watch: "watchScore",
  notifications: "myNotificationsMenu", lineup: "menuManageLineup", settings: "menuEventSettings",
};

const ICON: Record<MenuItemId, ReactNode> = {
  ics: <CalendarMonthIcon />, gcal: <CalendarMonthIcon />, cancel: <EventBusyIcon />,
  history: <HistoryIcon />, seasons: <GroupsIcon />, attendance: <EmojiPeopleIcon />, log: <AssignmentIcon />,
  ratings: <EmojiEventsIcon />, payments: <PaymentsIcon />, watch: <SportsSoccerIcon />,
  notifications: <NotificationsIcon />, lineup: <FormatListNumberedIcon />, settings: <SettingsIcon />,
};

const row = {
  display: "flex", alignItems: "center", justifyContent: "flex-start", gap: 1.5, width: "100%", minHeight: 48, px: 2, py: 1,
  textAlign: "left", fontSize: "1rem", color: "text.primary", textDecoration: "none", ...tappable,
  "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: "-2px" },
} as const;

/**
 * Content that scrolls says so: a soft shadow at an edge that still has more behind it,
 * drawn by the background itself (no script), so it works where scrollbars hide.
 */
const scrollShadow = (th: Theme) => {
  const paper = th.palette.background.paper;
  const shade = th.palette.mode === "dark" ? "rgba(0,0,0,.6)" : "rgba(0,0,0,.22)";
  return {
    overflowY: "auto", overscrollBehavior: "contain",
    background: [
      `linear-gradient(${paper} 30%, transparent) center top`,
      `linear-gradient(transparent, ${paper} 70%) center bottom`,
      `radial-gradient(farthest-side at 50% 0, ${shade}, transparent) center top`,
      `radial-gradient(farthest-side at 50% 100%, ${shade}, transparent) center bottom`,
    ].join(", "),
    backgroundRepeat: "no-repeat", backgroundSize: "100% 40px, 100% 40px, 100% 14px, 100% 14px",
    backgroundAttachment: "local, local, scroll, scroll",
  } as const;
};

/**
 * The ⋮ menu: a bottom sheet on a phone, a side sheet on the right from a tablet up.
 * Groups of 48px rows under a visible Close; it closes on Close, Esc, swipe or a tap outside,
 * and on a short screen the rows scroll under it.
 */
export function EventMenuSheet({ open, onClose, groups, eventId, menuId, owner, googleCalendarHref, onCancelGame, onOpenNotifications }: Props) {
  const t = useT();
  const theme = useTheme();
  const calm = useMediaQuery("(prefers-reduced-motion: reduce)");
  const side = useMediaQuery(theme.breakpoints.up("md"));

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
      case "lineup": return page("lineup");
      case "settings": return page("settings");
      case "watch": return link(`/watch/${eventId}`, true);
      case "cancel": return { onClick: () => { onClose(); onCancelGame(); } };
      case "notifications": return { onClick: () => { onClose(); onOpenNotifications(); } };
    }
  };

  return (
    <SwipeableDrawer
      anchor={side ? "right" : "bottom"} open={open} onOpen={() => {}} onClose={onClose} disableSwipeToOpen
      transitionDuration={calm ? 0 : undefined}
      // Above the install/update banners, so nothing in the sheet is ever covered by them.
      sx={{ zIndex: (th) => th.zIndex.snackbar + 2 }}
      slotProps={{
        paper: {
          id: menuId, ...{ "data-anchor": side ? "right" : "bottom" }, role: "dialog", "aria-modal": true, "aria-label": t("moreActions"),
          sx: side
            ? { width: "min(24rem, 100vw)", maxWidth: "100vw", display: "flex", flexDirection: "column", borderRadius: "20px 0 0 20px" }
            : {
              left: 0, right: 0, mx: "auto", maxWidth: "32rem", maxHeight: "calc(100dvh - 3rem)", display: "flex", flexDirection: "column",
              borderRadius: "20px 20px 0 0", pb: "calc(env(safe-area-inset-bottom) + 8px)",
            },
        },
      }}
    >
      <Box sx={{ flex: "none", display: "flex", alignItems: "center", justifyContent: "space-between", pl: 2, pr: 0.5, pt: side ? 1 : 0.5 }}>
        {!side && <Box aria-hidden sx={{ position: "absolute", top: 8, left: "50%", ml: "-18px", width: 36, height: 4, borderRadius: 2, bgcolor: "divider" }} />}
        <Typography component="span" sx={{ fontSize: "1.0625rem", fontWeight: 700, mt: side ? 0 : 1 }}>{t("moreActions")}</Typography>
        <IconButton aria-label={t("closeMenu")} onClick={onClose} sx={{ width: 44, height: 44, mt: side ? 0 : 1, color: "text.primary", ...tappable }}>
          <CloseIcon />
        </IconButton>
      </Box>
      <Box sx={(th) => ({ flex: "1 1 auto", minHeight: 0, ...scrollShadow(th) })}>
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
              <ButtonBase key={id} sx={{ ...row, color: id === "cancel" ? "error.main" : "text.primary", fontWeight: id === "cancel" ? 600 : 400 }} {...target(id)}>
                {ICON[id]}<span>{t(LABEL[id])}</span>
              </ButtonBase>
            ))}
          </Box>
        ))}
      </Box>
    </SwipeableDrawer>
  );
}
