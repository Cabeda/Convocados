import React from "react";
import {
  Button, Dialog, DialogTitle, DialogContent,
  DialogContentText, DialogActions, Snackbar,
} from "@mui/material";
import { useT } from "~/lib/useT";

interface Props {
  // Re-randomize confirmation
  confirmOpen: boolean;
  onConfirmClose: () => void;
  onConfirmRandomize: () => void;
  // Relinquish ownership
  relinquishConfirmOpen: boolean;
  onRelinquishClose: () => void;
  onRelinquishConfirm: () => void;
  // Snackbar
  snackbar: string | null;
  onSnackbarClose: () => void;
  // Undo remove
  undoData: { name: string } | null;
  onUndoDismiss: () => void;
  onUndo: () => void;
}

export function EventDialogs({
  confirmOpen, onConfirmClose, onConfirmRandomize,
  relinquishConfirmOpen, onRelinquishClose, onRelinquishConfirm,
  snackbar, onSnackbarClose,
  undoData, onUndoDismiss, onUndo,
}: Props) {
  const t = useT();

  return (
    <>
      <Dialog open={confirmOpen} onClose={onConfirmClose}>
        <DialogTitle>{t("rerandomizeTitle")}</DialogTitle>
        <DialogContent>
          <DialogContentText>{t("rerandomizeDesc")}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={onConfirmClose}>{t("cancel")}</Button>
          <Button onClick={onConfirmRandomize} variant="contained">{t("randomize")}</Button>
        </DialogActions>
      </Dialog>

      {/* Relinquish ownership confirmation */}
      <Dialog open={relinquishConfirmOpen} onClose={onRelinquishClose}>
        <DialogTitle>{t("relinquishOwnership")}</DialogTitle>
        <DialogContent>
          <DialogContentText>{t("relinquishOwnershipDesc")}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={onRelinquishClose}>{t("cancelEdit")}</Button>
          <Button onClick={onRelinquishConfirm} color="warning" variant="contained">
            {t("relinquishOwnership")}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={!!snackbar} autoHideDuration={3000} onClose={onSnackbarClose}
        message={snackbar} anchorOrigin={{ vertical: "bottom", horizontal: "center" }} />

      <Snackbar
        open={!!undoData}
        autoHideDuration={60000}
        onClose={onUndoDismiss}
        message={undoData ? t("undoRemoveDesc", { name: undoData.name }) : ""}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
        action={
          <Button color="inherit" size="small" onClick={onUndo}>
            {t("undoRemove")}
          </Button>
        }
      />
    </>
  );
}
