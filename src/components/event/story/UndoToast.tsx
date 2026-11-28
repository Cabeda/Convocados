import { Box, Button, Typography } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { useT } from "~/lib/useT";
import { tappable } from "./styles";
import { UNDO_WINDOW_MS } from "./useRosterRemoval";

/**
 * "Ana removed · Undo", with a thin line that shrinks over the minute an undo is offered.
 * Announced politely; it stays until it is used, dismissed or the window closes.
 */
export function UndoToast({ message, onUndo, onDismiss }: { message: string; onUndo: () => void; onDismiss: () => void }) {
  const t = useT();
  return (
    <Box
      role="status" data-testid="undo-toast"
      sx={{ position: "relative", mt: 1.5, overflow: "hidden", borderRadius: 2, bgcolor: "action.selected", display: "flex", alignItems: "center", minHeight: 48, pl: 2, pr: 0.5 }}
    >
      <Typography sx={{ flex: 1, fontSize: "0.9375rem", lineHeight: 1.35, overflowWrap: "anywhere" }}>{message}</Typography>
      <Button onClick={onUndo} sx={{ minHeight: 44, textTransform: "none", fontWeight: 700, ...tappable }}>{t("undoRemove")}</Button>
      <Button onClick={onDismiss} aria-label={t("ngDismiss")} sx={{ minHeight: 44, minWidth: 44, px: 1, color: "text.secondary", ...tappable }}><CloseIcon fontSize="small" /></Button>
      <Box
        aria-hidden data-testid="undo-progress"
        sx={{
          position: "absolute", left: 0, bottom: 0, height: 3, width: "100%", bgcolor: "primary.main", transformOrigin: "left",
          animation: `ngUndoShrink ${UNDO_WINDOW_MS}ms linear forwards`,
          "@keyframes ngUndoShrink": { from: { transform: "scaleX(1)" }, to: { transform: "scaleX(0)" } },
          "@media (prefers-reduced-motion: reduce)": { animation: "none" },
        }}
      />
    </Box>
  );
}
