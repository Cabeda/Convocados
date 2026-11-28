import { IconButton } from "@mui/material";
import ShareIcon from "@mui/icons-material/Share";
import { useLocale } from "~/lib/useT";
import { buildEventShareText, shareEvent } from "../shareEvent";
import { iconAction } from "./styles";

interface Props {
  title: string;
  dateTime: Date;
  timezone: string;
  location?: string | null;
  maxPlayers: number;
  playerCount: number;
  onToast: (message: string) => void;
}

/** Share the link: the phone's share sheet when there is one, the clipboard when not. */
export function ShareButton({ title, dateTime, timezone, location, maxPlayers, playerCount, onToast }: Props) {
  const { locale, t } = useLocale();

  const handleShare = async () => {
    const url = window.location.href;
    const text = buildEventShareText(
      { title, dateTime, timezone, location, maxPlayers, playerCount, url }, locale,
      { spotsLeft: (n) => t("spotsLeft", { n }), full: t("full") },
    );
    try {
      if (await shareEvent({ title, text, url })) onToast(t("linkCopiedFull"));
    } catch {
      onToast(t("somethingWentWrong"));
    }
  };

  return (
    <IconButton onClick={handleShare} aria-label={t("shareGame")} sx={iconAction}>
      <ShareIcon />
    </IconButton>
  );
}
