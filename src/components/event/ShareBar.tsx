import { useState } from "react";
import { IconButton, Snackbar } from "@mui/material";
import ShareIcon from "@mui/icons-material/Share";
import { useT } from "~/lib/useT";
import { detectLocale } from "~/lib/i18n";
import { buildEventShareText, shareEvent } from "./shareEvent";

interface Props {
  title: string;
  dateTime: Date;
  timezone: string;
  location?: string | null;
  maxPlayers: number;
  playerCount: number;
}

export function ShareBar({ title, dateTime, timezone, location, maxPlayers, playerCount }: Props) {
  const t = useT();
  const locale = detectLocale();
  const [snackbar, setSnackbar] = useState<string | null>(null);

  const url = typeof window !== "undefined" ? window.location.href : "";

  const details = { title, dateTime, timezone, location, maxPlayers, playerCount, url };
  const shareText = buildEventShareText(details, locale, {
    spotsLeft: (n) => t("spotsLeft", { n }),
    full: t("full"),
  });

  const handleShare = async () => {
    const copied = await shareEvent({ title, text: shareText, url });
    if (copied) {
      setSnackbar(t("linkCopiedFull"));
      setTimeout(() => setSnackbar(null), 2500);
    }
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