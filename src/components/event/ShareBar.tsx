import React, { useState } from "react";
import { Button, Typography, Paper } from "@mui/material";
import ShareIcon from "@mui/icons-material/Share";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import CheckIcon from "@mui/icons-material/Check";
import { useT } from "~/lib/useT";

interface Props {
  title: string;
}

export function ShareBar({ title }: Props) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const url = typeof window !== "undefined" ? window.location.href : "";
  const canShare = typeof navigator !== "undefined" && !!navigator.share;

  const handleShare = async () => {
    if (canShare) {
      try {
        await navigator.share({ title, url });
        return;
      } catch {
        // user cancelled or not supported — fall through to clipboard
      }
    }
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  // On mobile with native share, just show a button — no need to display the URL
  if (canShare) {
    return (
      <Button variant="contained" size="small" startIcon={<ShareIcon />} onClick={handleShare} sx={{ flexShrink: 0 }}>
        {t("shareGameMobile")}
      </Button>
    );
  }

  return (
    <Paper variant="outlined" sx={{ borderRadius: 2, p: 1, display: "flex", alignItems: "center", gap: 1, width: "100%" }}>
      <Typography variant="body2" color="text.secondary" sx={{
        flexGrow: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        fontFamily: "monospace", fontSize: "0.75rem", minWidth: 0,
      }}>
        {url}
      </Typography>
      <Button
        variant={copied ? "outlined" : "contained"}
        size="small"
        color={copied ? "success" : "primary"}
        startIcon={copied ? <CheckIcon /> : <ContentCopyIcon />}
        onClick={handleShare}
        sx={{ flexShrink: 0 }}
      >
        {copied ? t("linkCopied") : t("shareGame")}
      </Button>
    </Paper>
  );
}
