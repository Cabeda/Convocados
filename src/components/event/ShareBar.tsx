import React, { useState } from "react";
import { IconButton, Tooltip, Snackbar, Box, Typography } from "@mui/material";
import ShareIcon from "@mui/icons-material/Share";
import { useT } from "~/lib/useT";
import { detectLocale } from "~/lib/i18n";

interface Props {
  title: string;
  dateTime: Date;
  location?: string | null;
  maxPlayers: number;
  playerCount: number;
}

export function ShareBar({ title, dateTime, location, maxPlayers, playerCount }: Props) {
  const t = useT();
  const locale = detectLocale();
  const [snackbar, setSnackbar] = useState<string | null>(null);

  const spotsLeft = maxPlayers - playerCount;
  const url = typeof window !== "undefined" ? window.location.href : "";

  const formattedDate = dateTime.toLocaleString(locale === "pt" ? "pt-PT" : "en-GB", {
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
  });

  const shareText = [
    `⚽ ${title}`,
    `📅 ${formattedDate}`,
    location && `📍 ${location}`,
    spotsLeft > 0 ? `👥 ${t("spotsLeft", { n: spotsLeft })}` : `👥 ${t("full")}`,
  ]
    .filter(Boolean)
    .join("\n");

  const handleShare = async () => {
    const canShare = typeof navigator !== "undefined" && !!navigator.share;

    if (canShare) {
      try {
        await navigator.share({
          title,
          text: shareText,
          url,
        });
        return;
      } catch {
        // User cancelled
      }
    }

    // Fallback: copy link to clipboard
    await navigator.clipboard.writeText(url);
    setSnackbar(t("linkCopiedFull"));
    setTimeout(() => setSnackbar(null), 2500);
  };

  return (
    <>
      <IconButton
        onClick={handleShare}
        size="medium"
        aria-label={t("shareGame")}
        sx={{
          border: 1,
          borderColor: "divider",
          "&:hover": { bgcolor: "action.hover" },
        }}
      >
        <ShareIcon />
      </IconButton>

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