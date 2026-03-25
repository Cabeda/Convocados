import React, { useState } from "react";
import {
  Button, Typography, Paper, Dialog, DialogTitle,
  DialogContent, DialogContentText, DialogActions,
} from "@mui/material";
import WatchIcon from "@mui/icons-material/Watch";
import ShareIcon from "@mui/icons-material/Share";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import CheckIcon from "@mui/icons-material/Check";
import { useT } from "~/lib/useT";

interface Props {
  eventId: string;
}

export function WatchScoreButton({ eventId }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const watchUrl = typeof window !== "undefined"
    ? `${window.location.origin}/watch/${eventId}`
    : `/watch/${eventId}`;
  const canShare = typeof navigator !== "undefined" && !!navigator.share;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(watchUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleShare = async () => {
    if (canShare) {
      try {
        await navigator.share({ title: t("watchScore"), url: watchUrl });
        return;
      } catch { /* cancelled */ }
    }
    handleCopy();
  };

  return (
    <>
      <Button variant="outlined" size="small" startIcon={<WatchIcon />}
        onClick={() => setOpen(true)} sx={{ flexShrink: 0 }}>
        {t("watchScore")}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t("watchScore")}</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>{t("watchScoreDesc")}</DialogContentText>
          <Paper variant="outlined" sx={{ borderRadius: 2, p: 1.5, display: "flex", alignItems: "center", gap: 1 }}>
            <Typography variant="body2" sx={{
              flexGrow: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              fontFamily: "monospace", fontSize: "0.75rem", minWidth: 0,
            }}>
              {watchUrl}
            </Typography>
            <Button
              variant={copied ? "outlined" : "contained"}
              size="small"
              color={copied ? "success" : "primary"}
              startIcon={copied ? <CheckIcon /> : <ContentCopyIcon />}
              onClick={handleCopy}
              sx={{ flexShrink: 0 }}
            >
              {copied ? t("watchLinkCopied") : t("watchCopyLink")}
            </Button>
          </Paper>
        </DialogContent>
        <DialogActions>
          {canShare && (
            <Button onClick={handleShare} startIcon={<ShareIcon />}>
              {t("shareGameMobile")}
            </Button>
          )}
          <Button href={watchUrl} target="_blank" rel="noopener noreferrer" variant="contained">
            {t("watchScore")}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
