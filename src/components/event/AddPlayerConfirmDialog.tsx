import {
  Button, Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions,
  List, ListItem, ListItemIcon, ListItemText, Box,
} from "@mui/material";
import PersonAddIcon from "@mui/icons-material/PersonAdd";
import ScheduleSendIcon from "@mui/icons-material/ScheduleSend";
import ShareIcon from "@mui/icons-material/Share";
import { useT } from "~/lib/useT";

/**
 * Single-add confirmation intent. Carries enough context for the dialog to
 * render an accurate body (email footnote, bench footnote) and for the
 * caller to dispatch the actual `addPlayer` / invite call on confirm.
 */
export type AddPlayerIntent =
  | { kind: "single"; name: string; email?: string; userId?: string; source: "chip" | "dropdown" | "input" };

export interface AddPlayerConfirmDialogProps {
  intent: AddPlayerIntent | null;
  eventName: string;
  /** True if the player would be added to the bench (roster full). */
  isBench: boolean;
  /** True while the underlying add request is in flight. Disables the options. */
  isAdding: boolean;
  /** True while the underlying invite request is in flight. Disables the options. */
  isInviting: boolean;
  /** Single place for both Add (active) and Invite (pending) — asInvite flag selects the flow.
   *  via distinguishes the notifying invite ("notify") from the share-a-link invite ("link"). */
  onConfirm: (intent: AddPlayerIntent, asInvite: boolean, via?: "notify" | "link") => void;
  onClose: () => void;
}

export function AddPlayerConfirmDialog({
  intent, eventName, isBench, isAdding, isInviting, onConfirm, onClose,
}: AddPlayerConfirmDialogProps) {
  const t = useT();

  if (!intent) return null;

  const { name, email, userId } = intent;
  const hasContactChannel = !!email || !!userId;
  const busy = isAdding || isInviting;

  const inviteCaption = email
    ? t("choiceInviteDescEmail", { email })
    : t("choiceInviteDescUser", { name });

  return (
    <Dialog
      open={!!intent}
      onClose={onClose}
      maxWidth="xs"
      fullWidth
      aria-labelledby="add-player-confirm-title"
      aria-describedby="add-player-confirm-body"
    >
      <DialogTitle id="add-player-confirm-title">
        {t("addOrInviteTitle", { name })}
      </DialogTitle>
      <DialogContent>
        <DialogContentText id="add-player-confirm-body">
          {t("addOrInviteDesc", { name, eventName })}
        </DialogContentText>
        <List disablePadding sx={{ mt: 1 }}>
          <ListItem
            component="button"
            type="button"
            data-testid="add-player-confirm-add"
            disabled={busy}
            onClick={() => onConfirm(intent, false)}
            sx={{
              display: "flex", alignItems: "flex-start", gap: 1.5, width: "100%",
              border: 1, borderColor: "divider", borderRadius: 2, mb: 1,
              px: 1.5, py: 1.25, textAlign: "left", bgcolor: "transparent",
              cursor: "pointer", "&:hover": { bgcolor: "action.hover" },
            }}
          >
            <ListItemIcon sx={{ minWidth: 0, mt: 0.25 }}>
              <PersonAddIcon fontSize="small" color="primary" />
            </ListItemIcon>
            <ListItemText
              primary={t("choiceAddTitle")}
              secondary={isBench
                ? t("choiceAddDescBench", { name })
                : t("choiceAddDesc", { name })}
              slotProps={{
                primary: { sx: { fontWeight: 600 } },
                secondary: { sx: { mt: 0.25 } },
              }}
            />
          </ListItem>
          {hasContactChannel ? (
            <ListItem
              component="button"
              type="button"
              data-testid="add-player-confirm-invite"
              disabled={busy}
              onClick={() => onConfirm(intent, true, "notify")}
              sx={{
                display: "flex", alignItems: "flex-start", gap: 1.5, width: "100%",
                border: 1, borderColor: "divider", borderRadius: 2,
                px: 1.5, py: 1.25, textAlign: "left", bgcolor: "transparent",
                cursor: "pointer", "&:hover": { bgcolor: "action.hover" },
              }}
            >
              <ListItemIcon sx={{ minWidth: 0, mt: 0.25 }}>
                <ScheduleSendIcon fontSize="small" color="primary" />
              </ListItemIcon>
              <ListItemText
                primary={t("choiceInviteTitle")}
                secondary={inviteCaption}
                slotProps={{
                  primary: { sx: { fontWeight: 600 } },
                  secondary: { sx: { mt: 0.25 } },
                }}
              />
            </ListItem>
          ) : (
            <Box sx={{ px: 1.5, pt: 0.5 }}>
              <DialogContentText variant="body2" color="text.secondary">
                {t("inviteNeedsEmailHint")}
              </DialogContentText>
            </Box>
          )}
          {/* Link-share is available for every target — registered or guest.
              Guests have no channel at all, so this is their only invite path. */}
          <ListItem
            component="button"
            type="button"
            data-testid="add-player-confirm-share"
            disabled={busy}
            onClick={() => onConfirm(intent, true, "link")}
            sx={{
              display: "flex", alignItems: "flex-start", gap: 1.5, width: "100%",
              border: 1, borderColor: "divider", borderRadius: 2,
              px: 1.5, py: 1.25, textAlign: "left", bgcolor: "transparent",
              cursor: "pointer", "&:hover": { bgcolor: "action.hover" },
            }}
          >
            <ListItemIcon sx={{ minWidth: 0, mt: 0.25 }}>
              <ShareIcon fontSize="small" color="primary" />
            </ListItemIcon>
            <ListItemText
              primary={t("choiceShareLinkTitle")}
              secondary={t("choiceShareLinkDesc", { name })}
              slotProps={{
                primary: { sx: { fontWeight: 600 } },
                secondary: { sx: { mt: 0.25 } },
              }}
            />
          </ListItem>
        </List>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>{t("cancel")}</Button>
      </DialogActions>
    </Dialog>
  );
}