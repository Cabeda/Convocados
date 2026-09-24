import { useState } from "react";
import { Alert, Button } from "@mui/material";
import GroupAddIcon from "@mui/icons-material/GroupAdd";
import { useT } from "~/lib/useT";

const DISMISS_KEY = "add_games_prompt_dismissed_at";
const COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * Home growth prompt (ticket #1166): nudges players who play in games they
 * don't own to add their *other* games too. Dismissible with a 30-day
 * cooldown, mirroring PushPromptBanner's dismiss-and-cool-down pattern.
 * Renders only for a signed-in user the server flagged (`suggestAddGames`).
 */
export function AddGamesPrompt({ onAdd }: { onAdd: () => void }) {
  const t = useT();
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === "undefined") return true;
    const at = localStorage.getItem(DISMISS_KEY);
    return !!at && Date.now() - Number(at) < COOLDOWN_MS;
  });

  if (dismissed) return null;

  const handleDismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // storage unavailable — hide for this session only
    }
    setDismissed(true);
  };

  return (
    <Alert
      severity="info"
      icon={<GroupAddIcon />}
      action={
        <>
          <Button color="inherit" size="small" onClick={onAdd}>
            {t("addGamesCta")}
          </Button>
          <Button color="inherit" size="small" onClick={handleDismiss}>
            {t("dismiss")}
          </Button>
        </>
      }
      sx={{ mb: 2 }}
    >
      <strong>{t("addGamesPromptTitle")}</strong> — {t("addGamesPromptBody")}
    </Alert>
  );
}
