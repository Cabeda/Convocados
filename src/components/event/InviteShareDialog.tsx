import { useState } from "react";
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Typography, Button, TextField, Snackbar,
} from "@mui/material";
import LinkIcon from "@mui/icons-material/Link";
import { useT } from "~/lib/useT";

interface Props {
  open: boolean;
  name: string;
  url: string;
  onClose: () => void;
}

/**
 * ADR 0025: shown when an invitee has no notification channels enabled
 * (no email, web push or app push). The invite would otherwise be invisible,
 * so the inviter is pushed to share the invite link directly.
 */
export function InviteShareDialog({ open, name, url, onClose }: Props) {
  const t = useT();
  const [snackbar, setSnackbar] = useState<string | null>(null);

  const handleShare = async () => {
    if (typeof navigator !== "undefined" && !!navigator.share) {
      try {
        await navigator.share({ title: name, url });
        onClose();
        return;
      } catch {
        // User cancelled — fall through to copy
      }
    }
    await navigator.clipboard.writeText(url);
    setSnackbar(t("inviteLinkCopied"));
    setTimeout(() => setSnackbar(null), 2500);
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(url);
    setSnackbar(t("inviteLinkCopied"));
    setTimeout(() => setSnackbar(null), 2500);
  };

  return (
    <>
      <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <LinkIcon color="primary" />
          {(t as any)("inviteShareTitle", { name }) || t("inviteNoChannels", { name })}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            {(t as any)("inviteShareDesc", { name }) || t("inviteNoChannelsDesc")}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
            {(t as any)("inviteShareHint") || "Anyone with the link can view the invite. Only the invited account can accept it."}
          </Typography>
          <TextField
            fullWidth
            size="small"
            value={url}
            onFocus={(e) => e.target.select()}
            sx={{ mt: 1.5 }}
            slotProps={{ htmlInput: { readOnly: true } }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} color="inherit">{t("cancel")}</Button>
          <Button onClick={handleCopy} color="inherit">{t("inviteCopyLink")}</Button>
          <Button onClick={handleShare} variant="contained" color="primary">{t("inviteShareLink")}</Button>
        </DialogActions>
      </Dialog>
      <Snackbar
        open={!!snackbar}
        message={snackbar}
        autoHideDuration={2500}
        onClose={() => setSnackbar(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      />
    </>
  );
}