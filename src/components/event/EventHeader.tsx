/* eslint-disable @eslint-react/purity -- React Compiler hint, not a bug. Reading the clock during render is how "has the game ended" is decided. */
import { useEffect, useRef, useState } from "react";
import { Box, Button, Chip, Tooltip, Typography, useMediaQuery, useTheme } from "@mui/material";
import BookmarkBorderIcon from "@mui/icons-material/BookmarkBorder";
import EditIcon from "@mui/icons-material/Edit";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import { useLocale } from "~/lib/useT";
import { googleCalendarUrl } from "~/lib/calendar";
import { isGameEnded } from "~/lib/gameStatus";
import { canViewPrice, menuGroups } from "~/lib/eventHeader";
import type { Imatch } from "~/lib/random";
import type { EventData } from "./types";
import { MyNotificationsDialog } from "./MyNotificationsDialog";
import { SignInButton } from "../SignInButton";
import { EventEditForm, type EditField, type EventEdits } from "./story/EventEditForm";
import { EventInfoLines } from "./story/EventInfoLines";
import { EventMenuSheet } from "./story/EventMenuSheet";
import { FollowToggle } from "./story/FollowToggle";
import { HeaderToast, useHeaderToasts } from "./story/HeaderToast";
import { ShareButton } from "./story/ShareButton";
import { iconAction, tappable, textAction } from "./story/styles";

const MENU_ID = "event-menu";
const EDIT_ID = "event-edit-form";

interface Props {
  eventId: string;
  event: EventData;
  sport: string;
  gameDate: Date;
  /** Owner or event admin. */
  canEditSettings: boolean;
  isAuthenticated: boolean;
  isOwnerless: boolean;
  /** A linked player on the roster: the server lets them read the price. */
  isParticipant: boolean;
  localMatches: Imatch[] | null;
  gameStatus?: string | null;
  onSaveTitle: (title: string) => Promise<void>;
  onSaveLocation: (location: string) => Promise<void>;
  onSaveDateTime: (dateTime: string, timezone: string) => Promise<void>;
  onSaveSport: (sport: string) => Promise<void>;
  /** Rejects when the server says no, so the header can say so. */
  onClaimOwnership: () => Promise<void>;
  onCancelGame: () => void;
  /** After an in-place sign-in from "Sign in to follow". */
  onSignedIn?: () => void;
}

/**
 * The top of the event page, flat on the page background: the title with Share and ⋮,
 * then when and where, then a quiet row of words — Follow game, and Edit for an admin.
 * Everything else lives in the ⋮ sheet.
 */
export function EventHeader({
  eventId, event, sport, gameDate, canEditSettings, isAuthenticated, isOwnerless, isParticipant, localMatches, gameStatus,
  onSaveTitle, onSaveLocation, onSaveDateTime, onSaveSport, onClaimOwnership, onCancelGame, onSignedIn,
}: Props) {
  const { t } = useLocale();
  const isMobile = useMediaQuery(useTheme().breakpoints.down("sm"));
  const [editing, setEditing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [claimFailed, setClaimFailed] = useState(false);
  const { queue, push: setToast, next } = useHeaderToasts();
  const pencilRef = useRef<HTMLButtonElement>(null);
  const wasEditingRef = useRef(false);

  // Back to the pencilRef when the form closes, so a keyboard user does not lose their place.
  useEffect(() => {
    if (wasEditingRef.current && !editing) pencilRef.current?.focus();
    wasEditingRef.current = editing;
  }, [editing]);

  // Close only once the server has said yes. A refused field keeps the form (and the draft) open.
  const submit = async (e: EventEdits): Promise<EditField[]> => {
    const jobs: [EditField, Promise<void> | false][] = [
      ["title", e.title !== undefined && onSaveTitle(e.title)],
      ["location", e.location !== undefined && onSaveLocation(e.location)],
      ["dateTime", !!e.dateTime && onSaveDateTime(e.dateTime.value, e.dateTime.timezone)],
      ["sport", !!e.sport && onSaveSport(e.sport)],
    ];
    const results = await Promise.allSettled(jobs.map(([, job]) => job || Promise.resolve()));
    const refused = jobs.filter((_, i) => results[i].status === "rejected").map(([field]) => field);
    if (refused.length === 0) {
      setEditing(false);
      setToast(t("saved"));
    }
    return refused;
  };

  const claim = async () => {
    if (claiming) return;
    setClaiming(true);
    setClaimFailed(false);
    try {
      await onClaimOwnership();
      setToast(t("claimedToast"));
    } catch {
      setClaimFailed(true);
    } finally {
      setClaiming(false);
    }
  };

  const cancelled = gameStatus === "cancelled";
  const gameEnded = isGameEnded(event.dateTime, event.durationMinutes ?? 60);
  const groups = menuGroups({
    canEdit: canEditSettings, isOwnerless, isAuthenticated,
    ratingsOn: event.eloEnabled ?? true,
    calendarOpen: !cancelled && !gameEnded,
    showAttendance: gameDate < new Date() || !!event.isRecurring,
    canWatch: isMobile && !!localMatches?.length,
    isCancelled: cancelled,
    paymentsReachable: isAuthenticated || (isOwnerless && !event.isPublic),
  });
  const googleCalendarHref = googleCalendarUrl({
    id: eventId, title: event.title, location: event.location, dateTime: gameDate,
    url: typeof window !== "undefined" ? window.location.href : undefined,
    recurrence: event.isRecurring && event.recurrenceRule ? JSON.parse(event.recurrenceRule) : undefined,
  });

  return (
    <Box component="header">
      <Box sx={{ display: "flex", alignItems: "flex-start", gap: 0.5 }}>
        <Box sx={{ flex: 1, minWidth: 0, minHeight: 44, display: "flex", alignItems: "center", py: 0.5 }}>
          <Typography
            component="h1" title={event.title}
            sx={{
              fontSize: { xs: "1.5rem", sm: "1.75rem" }, fontWeight: 700, lineHeight: 1.15, m: 0,
              overflowWrap: "anywhere", textWrap: "balance",
              // Three lines at most; the whole title is in the edit form and the tooltip.
              display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: 3, overflow: "hidden",
            }}
          >
            {event.title}
          </Typography>
        </Box>
        {/* The icons' glyphs, not their 44px boxes, line up with the page edge. */}
        <Box sx={{ display: "flex", flexShrink: 0, mr: -1.25 }}>
          {!cancelled && (
            <ShareButton
              title={event.title} dateTime={gameDate} timezone={event.timezone} location={event.location}
              maxPlayers={event.maxPlayers} playerCount={event.players.length} onToast={setToast}
            />
          )}
          <Tooltip title={t("moreActions")}>
            <Button
              aria-label={t("moreActions")} aria-haspopup="dialog" aria-expanded={menuOpen} aria-controls={menuOpen ? MENU_ID : undefined}
              onClick={() => setMenuOpen(true)}
              sx={{ ...iconAction, minWidth: 44, px: { xs: 0, md: 1.5 }, width: { xs: 44, md: "auto" }, gap: 0.5, borderRadius: { xs: "50%", md: 999 }, textTransform: "none", fontSize: "1rem", fontWeight: 600 }}
            >
              <MoreVertIcon />
              <Box component="span" sx={{ display: { xs: "none", md: "inline" } }}>{t("moreActions")}</Box>
            </Button>
          </Tooltip>
        </Box>
      </Box>

      {event.archivedAt && <Chip label={t("archivedBadge")} size="small" variant="outlined" sx={{ mt: 0.5 }} />}

      {editing
        ? <EventEditForm event={event} sport={sport} onSave={submit} onCancel={() => setEditing(false)} />
        : (
          <EventInfoLines
            eventId={eventId} event={event} gameDate={gameDate} canEdit={canEditSettings} cancelled={cancelled}
            canViewPrice={canViewPrice({ canEdit: canEditSettings, isParticipant, isOwnerless, isPublic: !!event.isPublic })}
            ended={gameEnded}
          />
        )}

      {isAuthenticated && isOwnerless && (
        <Box sx={{ mt: 1 }}>
          <Chip
            label={t("claimThisGame")} color="primary" variant="outlined" clickable disabled={claiming} onClick={claim}
            sx={{ height: 44, borderRadius: 999, fontWeight: 600, fontSize: "1rem", ...tappable }}
          />
          {claimFailed && <Typography role="alert" sx={{ mt: 0.5, color: "error.main", fontSize: "1rem", lineHeight: 1.4 }}>{t("claimFailed")}</Typography>}
        </Box>
      )}

      {/* The words for what the glyphs above might leave a reader guessing at. */}
      {(!cancelled || canEditSettings) && (
        <Box sx={{ mt: 0.5, ml: -1.25, display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: 0.5 }}>
          {!cancelled && (isAuthenticated
            ? <FollowToggle eventId={eventId} onToast={setToast} />
            : (
              <SignInButton
                callbackURL={typeof window !== "undefined" ? window.location.pathname : `/events/${eventId}`}
                onSuccess={onSignedIn} startIcon={<BookmarkBorderIcon />} sx={textAction}
              >
                {t("signInToFollow")}
              </SignInButton>
            ))}
          {canEditSettings && (
            <Button
              ref={pencilRef} aria-expanded={editing} aria-controls={editing ? EDIT_ID : undefined}
              onClick={() => setEditing((v) => !v)} startIcon={<EditIcon />} sx={textAction}
            >
              {t("editDateTime")}
            </Button>
          )}
        </Box>
      )}

      <EventMenuSheet
        open={menuOpen} onClose={() => setMenuOpen(false)} groups={groups} eventId={eventId} menuId={MENU_ID}
        owner={event.ownerId && event.ownerName ? { id: event.ownerId, name: event.ownerName } : null}
        googleCalendarHref={googleCalendarHref} onCancelGame={onCancelGame} onOpenNotifications={() => setNotificationsOpen(true)}
      />
      <MyNotificationsDialog eventId={eventId} open={notificationsOpen} onClose={() => setNotificationsOpen(false)} />
      <HeaderToast queue={queue} onDone={next} />
    </Box>
  );
}
