import {
  Button, Dialog, DialogTitle, DialogContent,
  DialogContentText, DialogActions, Alert,
} from "@mui/material";
import { useT } from "~/lib/useT";
import { HeaderToast } from "./story/HeaderToast";

interface Props {
  // Relinquish ownership
  relinquishConfirmOpen: boolean;
  onRelinquishClose: () => void;
  onRelinquishConfirm: () => void;
  // Cancel game confirmation
  cancelConfirmOpen: boolean;
  onCancelConfirmClose: () => void;
  onCancelConfirm: () => void;
  cancelConfirmBusy: boolean;
  isRecurring: boolean;
  // Snackbar
  toastQueue: string[];
  onToastDone: () => void;
}

export function EventDialogs({
  relinquishConfirmOpen, onRelinquishClose, onRelinquishConfirm,
  cancelConfirmOpen, onCancelConfirmClose, onCancelConfirm, cancelConfirmBusy, isRecurring,
  toastQueue, onToastDone,
}: Props) {
  const t = useT();

  return (
    <>
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

      {/* Cancel game confirmation */}
      <Dialog open={cancelConfirmOpen} onClose={cancelConfirmBusy ? undefined : onCancelConfirmClose}>
        <DialogTitle>{t("cancelGameConfirmTitle")}</DialogTitle>
        <DialogContent>
          <DialogContentText>{t("cancelGameConfirmDesc")}</DialogContentText>
          {isRecurring && (
            <Alert severity="info" sx={{ mt: 2 }}>
              {t("cancelGameRecurringNote")}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={onCancelConfirmClose} disabled={cancelConfirmBusy}>{t("cancelEdit")}</Button>
          <Button onClick={onCancelConfirm} color="error" variant="contained" disabled={cancelConfirmBusy}>
            {t("cancelGame")}
          </Button>
        </DialogActions>
      </Dialog>

      <HeaderToast queue={toastQueue} onDone={onToastDone} />
    </>
  );
}
