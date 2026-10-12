import {
  Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions,
  Button, Stack, Alert,
} from "@mui/material";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import { useT } from "~/lib/useT";

export type LeaveContext = "self" | "organizer";

/**
 * Pure helpers for the dialog's inputs — extracted out of component bodies so the
 * Date.now() inside doesn't trip the eslint react-hooks/purity rule. They run in
 * event handlers, never during render.
 */
export function computeBenchEmptyAfter(
  playerId: string,
  players: { id: string }[],
  active: { id: string }[],
  maxPlayers: number,
): boolean {
  const wasActive = active.some((p) => p.id === playerId);
  if (!wasActive) return false; // bench player leaving — not "no replacement" for the active roster
  // Bench is currently empty iff total players fit within maxPlayers. If there are already
  // bench players, the leave flow promotes the first one to active, so the slot IS filled.
  return players.length <= maxPlayers;
}

export function computeWithin48h(eventDateTime: string | undefined): boolean {
  if (!eventDateTime) return false;
  const kickoff = new Date(eventDateTime).getTime();
  const hoursUntil = (kickoff - Date.now()) / (60 * 60 * 1000);
  return hoursUntil > 0 && hoursUntil <= 48;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  /** Who is initiating the leave. self = the player themselves, organizer = owner/admin acting on someone. */
  context: LeaveContext;
  /** Name of the player being removed (used in the organizer copy). For self, this is the user's own name (shown in the title for clarity). */
  playerName: string;
  /** Whether the bench is empty AFTER the removal. Triggers the additional "no replacement" warning. */
  benchEmptyAfter: boolean;
  /** Whether we're inside the 48h-before-kickoff window. The "no replacement" warning is only shown when this is true. */
  within48h: boolean;
  /** Disable the confirm button while the leave API is in flight. */
  busy?: boolean;
}

/**
 * #XXX Confirm-leave dialog. Used by every "remove from player list" path:
 *  - User "No" on the You row
 *  - User Quick Leave pill
 *  - Organizer X on a player row
 *  - Admin "No" on a guest pill (cycles guest RSVP to "no" → archived)
 *
 * The "no replacement" warning fires only when (within48h && benchEmptyAfter).
 * The body copy is one of two variants per context (with/without the warning), and
 * a separate Alert below the body surfaces the 48h/no-replacement risk prominently.
 */
export function ConfirmLeaveDialog({
  open,
  onClose,
  onConfirm,
  context,
  playerName,
  benchEmptyAfter,
  within48h,
  busy,
}: Props) {
  const t = useT();
  const showReplacementWarning = within48h && benchEmptyAfter;

  const title = context === "self"
    ? t("leaveDialogSelfTitle")
    : t("leaveDialogOrganizerTitle", { name: playerName });

  const body = context === "self"
    ? (showReplacementWarning ? t("leaveDialogSelfBody") : t("leaveDialogSelfBodyNoWarn"))
    : (showReplacementWarning ? t("leaveDialogOrganizerBody", { name: playerName }) : t("leaveDialogOrganizerBodyNoWarn", { name: playerName }));

  const confirmLabel = context === "self" ? t("leaveDialogConfirmSelf") : t("leaveDialogConfirmOrganizer");

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <DialogContentText>{body}</DialogContentText>
          {showReplacementWarning && (
            <Alert
              severity="warning"
              icon={<WarningAmberIcon />}
              data-testid="leave-dialog-no-replacement"
            >
              <strong>{t("leaveDialogNoReplacementTitle")}.</strong> {t("leaveDialogNoReplacementBody")}
            </Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy} data-testid="leave-dialog-cancel">
          {t("leaveDialogCancel")}
        </Button>
        <Button
          onClick={onConfirm}
          color="error"
          variant="contained"
          disabled={busy}
          data-testid="leave-dialog-confirm"
        >
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
