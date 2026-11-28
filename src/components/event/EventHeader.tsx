/* eslint-disable @eslint-react/purity -- React Compiler hint, not a bug. Reading the clock during render is how "has the game ended" is decided. */
import { useEffect, useRef, useState } from "react";
import { Box, Chip, IconButton, Typography, useMediaQuery, useTheme } from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import { useLocale } from "~/lib/useT";
import { googleCalendarUrl } from "~/lib/calendar";
import { isGameEnded } from "~/lib/gameStatus";
import { menuGroups } from "~/lib/eventHeader";
import type { Imatch } from "~/lib/random";
import type { EventData } from "./types";
import { MyNotificationsDialog } from "./MyNotificationsDialog";
import { EventEditForm, type EventEdits } from "./story/EventEditForm";
import { EventInfoLines } from "./story/EventInfoLines";
import { EventMenuSheet } from "./story/EventMenuSheet";
import { FollowToggle } from "./story/FollowToggle";
import { HeaderToast } from "./story/HeaderToast";
import { ShareButton } from "./story/ShareButton";
import { iconAction, tappable } from "./story/styles";

interface Props {
  eventId: string;
  event: EventData;
  sport: string;
  gameDate: Date;
  /** Owner or event admin. */
  canEditSettings: boolean;
  isAuthenticated: boolean;
  isOwnerless: boolean;
  localMatches: Imatch[] | null;
  gameStatus?: string | null;
  onSaveTitle: (title: string) => Promise<void>;
  onSaveLocation: (location: string) => Promise<void>;
  onSaveDateTime: (dateTime: string, timezone: string) => Promise<void>;
  onSaveSport: (sport: string) => Promise<void>;
  onClaimOwnership: () => Promise<void>;
  onCancelGame: () => void;
}

/**
 * The top of the event page, flat on the page background: the title with its four actions
 * (edit, share, follow, more), then when and where. Everything else lives in the ⋮ sheet.
 * TODO(slice-3): the countdown (under 24 h) and the live pill come back with the next-game block.
 */
export function EventHeader({
  eventId, event, sport, gameDate, canEditSettings, isAuthenticated, isOwnerless, localMatches, gameStatus,
  onSaveTitle, onSaveLocation, onSaveDateTime, onSaveSport, onClaimOwnership, onCancelGame,
}: Props) {
  const { t } = useLocale();
  const isMobile = useMediaQuery(useTheme().breakpoints.down("sm"));
  const [editing, setEditing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const pencilRef = useRef<HTMLButtonElement>(null);
  const wasEditingRef = useRef(false);

  // Back to the pencilRef when the form closes, so a keyboard user does not lose their place.
  useEffect(() => {
    if (wasEditingRef.current && !editing) pencilRef.current?.focus();
    wasEditingRef.current = editing;
  }, [editing]);

  // Keyboard shortcut `e` toggles the form.
  useEffect(() => {
    if (!canEditSettings) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.metaKey || e.ctrlKey) return;
      if (e.key === "e") { e.preventDefault(); setEditing((v) => !v); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canEditSettings]);

  const submit = async (e: EventEdits) => {
    setEditing(false);
    try {
      await Promise.all([
        e.title !== undefined && onSaveTitle(e.title),
        e.location !== undefined && onSaveLocation(e.location),
        e.dateTime && onSaveDateTime(e.dateTime.value, e.dateTime.timezone),
        e.sport && onSaveSport(e.sport),
      ]);
      setToast(t("saved"));
    } catch {
      setToast(t("editSaveFailed"));
    }
  };

  const claim = async () => {
    if (claiming) return;
    setClaiming(true);
    try { await onClaimOwnership(); } finally { setClaiming(false); }
  };

  const cancelled = gameStatus === "cancelled";
  const groups = menuGroups({
    canEdit: canEditSettings, isOwnerless, isAuthenticated,
    ratingsOn: event.eloEnabled ?? true,
    calendarOpen: !cancelled && !isGameEnded(event.dateTime, event.durationMinutes ?? 60),
    showAttendance: gameDate < new Date() || !!event.isRecurring,
    canWatch: isMobile && !!localMatches?.length,
    isCancelled: cancelled,
  });
  const googleCalendarHref = googleCalendarUrl({
    id: eventId, title: event.title, location: event.location, dateTime: gameDate,
    url: typeof window !== "undefined" ? window.location.href : undefined,
    recurrence: event.isRecurring && event.recurrenceRule ? JSON.parse(event.recurrenceRule) : undefined,
  });

  return (
    <Box component="header">
      <Box sx={{ display: "flex", alignItems: "flex-start", gap: 0.5 }}>
        <Box sx={{ flex: 1, minWidth: 0, minHeight: 44, display: "flex", alignItems: "center", flexWrap: "wrap", gap: 1, py: 0.5 }}>
          <Typography component="h1" sx={{ fontSize: "1.75rem", fontWeight: 700, lineHeight: 1.15, overflowWrap: "anywhere", textWrap: "balance" }}>
            {event.title}
          </Typography>
          {event.archivedAt && <Chip label={t("archivedBadge")} size="small" variant="outlined" />}
        </Box>
        {/* The icons' glyphs, not their 44px boxes, line up with the page edge. */}
        <Box sx={{ display: "flex", flexShrink: 0, mr: -1.25 }}>
          {canEditSettings && (
            <IconButton ref={pencilRef} aria-label={t("editDateTime")} aria-expanded={editing} onClick={() => setEditing((v) => !v)} sx={{ ...iconAction, color: "text.secondary" }}>
              <EditIcon />
            </IconButton>
          )}
          <ShareButton
            title={event.title} dateTime={gameDate} timezone={event.timezone} location={event.location}
            maxPlayers={event.maxPlayers} playerCount={event.players.length} onToast={setToast}
          />
          {isAuthenticated && <FollowToggle eventId={eventId} onToast={setToast} />}
          <IconButton aria-label={t("moreActions")} aria-haspopup="dialog" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)} sx={iconAction}>
            <MoreVertIcon />
          </IconButton>
        </Box>
      </Box>

      {editing
        ? <EventEditForm event={event} sport={sport} onSave={submit} onCancel={() => setEditing(false)} />
        : <EventInfoLines eventId={eventId} event={event} gameDate={gameDate} canEdit={canEditSettings} isAuthenticated={isAuthenticated} />}

      {isAuthenticated && isOwnerless && (
        <Chip
          label={t("claimThisGame")} color="primary" variant="outlined" clickable disabled={claiming} onClick={claim}
          sx={{ mt: 1, height: 36, fontWeight: 600, ...tappable }}
        />
      )}

      <EventMenuSheet
        open={menuOpen} onClose={() => setMenuOpen(false)} groups={groups} eventId={eventId}
        owner={event.ownerId && event.ownerName ? { id: event.ownerId, name: event.ownerName } : null}
        googleCalendarHref={googleCalendarHref} onCancelGame={onCancelGame} onOpenNotifications={() => setNotificationsOpen(true)}
      />
      <MyNotificationsDialog eventId={eventId} open={notificationsOpen} onClose={() => setNotificationsOpen(false)} />
      <HeaderToast message={toast} onClose={() => setToast(null)} />
    </Box>
  );
}
