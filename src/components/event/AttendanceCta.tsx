import React from "react";
import {
  Box, Button, Stack, Typography,
} from "@mui/material";
import HowToRegIcon from "@mui/icons-material/HowToReg";
import RemoveCircleOutlineIcon from "@mui/icons-material/RemoveCircleOutline";
import { useT } from "~/lib/useT";
import type { RsvpStatus } from "~/lib/rsvp";

export type { RsvpStatus } from "~/lib/rsvp";

interface Props {
  /** Current Rsvp status for the user (yes / no / pending). */
  myRsvpStatus: RsvpStatus;
  /** Whether the user is on the player list for this event. Drives the "Join this game" label
   *  on the Going button and the small hint when the Not-coming click only records the response
   *  (no removal needed because the user isn't on the list). */
  isOnList: boolean;
  /** Called when the user taps "Going". The caller is responsible for routing through the
   *  payment-nudge dialog + add-to-list + Rsvp=yes. */
  onGoing: () => void;
  /** Called when the user taps "Not coming". The caller decides whether to open the
   *  confirm dialog (if on the list) or just record Rsvp=no (if not on the list). */
  onNotComing: () => void;
  /** Disable both buttons while a request is in flight. */
  busy?: boolean;
}

/**
 * #XXX Unified attendance widget. Replaces the Quick Join + Quick Leave + You row trio.
 *  Two big buttons, always shown for a logged-in user who is on the list or following the event.
 *  The current state is visually highlighted; the active state is disabled.
 *
 *  Anonymous viewers, signed-out users, and users with no connection to the event see nothing.
 */
export function AttendanceCta({
  myRsvpStatus, isOnList, onGoing, onNotComing, busy,
}: Props) {
  const t = useT();

  const goingLabel = isOnList ? t("attendanceCtaGoing") : t("attendanceCtaJoinGame");
  const notComingLabel = t("attendanceCtaNotComing");

  return (
    <Box
      data-testid="attendance-cta"
      sx={{
        p: 1.5,
        borderRadius: 2,
        bgcolor: (theme) => alpha(theme.palette.primary.main, 0.08),
        border: (theme) => `1px solid ${alpha(theme.palette.primary.main, 0.3)}`,
      }}
    >
      <Stack spacing={1}>
        <Typography variant="caption" sx={{ fontWeight: 600, color: "text.secondary", textTransform: "uppercase", letterSpacing: 0.5 }}>
          {t("attendanceCtaTitle")}
        </Typography>
        <Stack direction="row" spacing={1}>
          <Button
            fullWidth
            variant={myRsvpStatus === "yes" ? "contained" : "outlined"}
            color={myRsvpStatus === "yes" ? "success" : "inherit"}
            startIcon={<HowToRegIcon />}
            onClick={onGoing}
            disabled={busy || myRsvpStatus === "yes"}
            data-testid="attendance-cta-going"
          >
            {goingLabel}
          </Button>
          <Button
            fullWidth
            variant={myRsvpStatus === "no" ? "contained" : "outlined"}
            color={myRsvpStatus === "no" ? "error" : "inherit"}
            startIcon={<RemoveCircleOutlineIcon />}
            onClick={onNotComing}
            disabled={busy}
            data-testid="attendance-cta-not-coming"
          >
            {notComingLabel}
          </Button>
        </Stack>
        {!isOnList && myRsvpStatus !== null && (
          <Typography variant="caption" color="text.secondary" data-testid="attendance-cta-hint">
            {t("attendanceCtaNotOnListHint")}
          </Typography>
        )}
      </Stack>
    </Box>
  );
}

// Local helper — alpha() from MUI is heavier than a one-liner.
function alpha(color: string, value: number) {
  return `${color}${Math.round(value * 255).toString(16).padStart(2, "0")}`;
}
