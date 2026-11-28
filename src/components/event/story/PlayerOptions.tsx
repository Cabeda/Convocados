import { useEffect, useRef } from "react";
import { Box, Button, IconButton, Typography } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { useT } from "~/lib/useT";
import type { Player } from "../types";
import { tappable } from "./styles";

/**
 * The options for one person in the lineup: their name and "Remove" ("Leave" on the viewer's own slot). It opens with focus on Remove,
 * closes on Escape or the ×, and the page puts focus back where it was opened from.
 */
export function PlayerOptions({ player, id, onRemove, onClose, disabled, self, onClaim }: { player: Player; id?: string; onRemove: () => void; onClose: () => void; disabled?: boolean; self?: boolean; onClaim?: () => void }) {
  const t = useT();
  const removeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { removeRef.current?.focus(); }, []);
  return (
    <Box
      id={id} role="group" aria-label={t("ngOptionsFor", { name: player.name })} data-testid="player-options"
      onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}
      sx={{ display: "flex", alignItems: "center", mt: 1, minHeight: 52, pl: 2, pr: 0.5, borderRadius: 2, bgcolor: "action.hover" }}
    >
      <Typography sx={{ flex: 1, minWidth: 0, fontSize: "1rem", fontWeight: 700, overflowWrap: "anywhere" }}>{player.name}</Typography>
      {onClaim && <Button disabled={disabled} onClick={onClaim} sx={{ minHeight: 44, textTransform: "none", fontWeight: 700, ...tappable }}>{t("ngClaimMine")}</Button>}
      <Button ref={removeRef} color="error" disabled={disabled} onClick={onRemove} {...(self ? {} : { "aria-label": t("ngManageRemoveAria", { name: player.name }) })} sx={{ minHeight: 44, textTransform: "none", fontWeight: 700, ...tappable }}>
        {self ? t("leave") : t("ngRemove")}
      </Button>
      <IconButton aria-label={t("ngCloseAria")} onClick={onClose} sx={{ width: 44, height: 44, color: "text.secondary", ...tappable }}><CloseIcon fontSize="small" /></IconButton>
    </Box>
  );
}
