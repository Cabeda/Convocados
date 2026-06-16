import React from "react";
import {
  Button, Dialog, DialogTitle, DialogContent,
  DialogContentText, DialogActions,
} from "@mui/material";
import { useT } from "~/lib/useT";

/**
 * Single-add confirmation intent. Carries enough context for the dialog to
 * render an accurate body (email footnote, bench footnote) and for the
 * caller to dispatch the actual `addPlayer` call on confirm.
 */
export type AddPlayerIntent =
  | { kind: "single"; name: string; email?: string; source: "chip" | "dropdown" };

export interface AddPlayerConfirmDialogProps {
  intent: AddPlayerIntent | null;
  eventName: string;
  /** True if the player would be added to the bench (roster full). */
  isBench: boolean;
  /** True if the manager is adding via invite-by-email. */
  hasInviteEmail: boolean;
  /** True while the underlying add request is in flight. Disables the confirm button. */
  isAdding: boolean;
  onConfirm: (intent: AddPlayerIntent) => void;
  onClose: () => void;
}

export function AddPlayerConfirmDialog({
  intent, eventName, isBench, hasInviteEmail, isAdding, onConfirm, onClose,
}: AddPlayerConfirmDialogProps) {
  const t = useT();

  if (!intent) return null;

  const { name, email } = intent;
  const bodyKey = hasInviteEmail && isBench
    ? "addPlayerConfirmDescBoth"
    : hasInviteEmail
      ? "addPlayerConfirmDescEmail"
      : isBench
        ? "addPlayerConfirmDescBench"
        : "addPlayerConfirmDesc";

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
        {t("addPlayerConfirmTitle", { name })}
      </DialogTitle>
      <DialogContent>
        <DialogContentText id="add-player-confirm-body">
          {hasInviteEmail && email
            ? t(bodyKey, { name, eventName, email })
            : t(bodyKey, { name, eventName })}
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={isAdding}>{t("cancel")}</Button>
        <Button
          onClick={() => onConfirm(intent)}
          variant="contained"
          disabled={isAdding}
          data-testid="add-player-confirm"
        >
          {t("addPlayerConfirm")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
