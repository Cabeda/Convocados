import { Box } from "@mui/material";
import { useT } from "~/lib/useT";
import { SLOT_GAP, SLOT_MAX_SIZE, slotColumns, slotMinSize } from "~/lib/nextGame";

const bar = (w: string | number, h: string | number) => ({ width: w, height: h, borderRadius: 1, bgcolor: "action.hover", flex: "none" });

/**
 * The next game before its data is in: the same label, date, RSVP row and 16 slots at the same
 * heights, so the page does not move when the real block arrives.
 */
export function NextGameSkeleton({ maxPlayers = 16 }: { maxPlayers?: number }) {
  const t = useT();
  const columns = slotColumns(maxPlayers);
  const track = `max(${slotMinSize(maxPlayers)}px, calc((100% - ${(columns - 1) * SLOT_GAP}px) / ${columns} - 0.5px))`;
  return (
    <Box role="status" aria-busy="true" aria-label={t("ngLoading")} data-testid="next-game-skeleton" sx={{ maxWidth: "32rem" }}>
      <Box sx={{ ...bar("30%", 22), maxWidth: 140 }} />
      <Box sx={{ ...bar("65%", 42), maxWidth: 300, mt: "2px" }} />
      <Box sx={{ ...bar("100%", 56), borderRadius: 999, mt: 2 }} />
      <Box
        sx={{
          mt: 2.5, display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${track}, 1fr))`, gap: `${SLOT_GAP}px`,
          maxWidth: columns * SLOT_MAX_SIZE + (columns - 1) * SLOT_GAP,
        }}
      >
        {Array.from({ length: maxPlayers }, (_, i) => <Box key={i} sx={{ aspectRatio: "1", borderRadius: "50%", bgcolor: "action.hover" }} />)}
      </Box>
      <Box sx={{ ...bar("80%", 21), mt: 1.25 }} />
    </Box>
  );
}
