import React from "react";
import { Dialog, DialogTitle, DialogContent, IconButton, Box } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { SignInForm } from "./SignInForm";
import { useT } from "~/lib/useT";

export interface SignInModalProps {
  open: boolean;
  onClose: () => void;
  /**
   * Where Google redirect returns to / where to consider "done". For in-place
   * login on an event page this is the current path, so the user lands back on
   * the same event after the Google round-trip.
   */
  callbackURL: string;
  /**
   * Called after a successful email/password sign-in. The caller should close
   * the dialog and revalidate the session (no navigation needed — the user
   * stays on the current page).
   */
  onSuccess: () => void;
}

/**
 * In-place sign-in dialog. Lets a signed-out user log in without leaving the
 * page they're on (e.g. an event page). Email/password resolves entirely in
 * place via `onSuccess`; Google uses the same top-level redirect as the full
 * page but returns to `callbackURL` (the current path).
 */
export function SignInModal({ open, onClose, callbackURL, onSuccess }: SignInModalProps) {
  const t = useT();
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ pr: 6 }}>
        {t("signIn")}
        <IconButton
          aria-label={t("dismiss")}
          onClick={onClose}
          sx={{ position: "absolute", right: 8, top: 8 }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        <Box sx={{ pt: 1 }}>
          <SignInForm callbackURL={callbackURL} onSuccess={onSuccess} />
        </Box>
      </DialogContent>
    </Dialog>
  );
}
