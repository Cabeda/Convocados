import { Box } from "@mui/material";
import { useT } from "~/lib/useT";
import { useSlotGrid } from "./useSlotGrid";

const bar = (w: string | number, h: string | number) => ({ width: w, height: h, borderRadius: 1, bgcolor: "action.hover", flex: "none" });

/**
 * The next game before its data is in: the same label, date, RSVP row and 16 slots at the same
 * heights, so the page does not move when the real block arrives.
 */
export function NextGameSkeleton({ maxPlayers = 16, headerOnly = false }: { maxPlayers?: number; headerOnly?: boolean }) {
  const t = useT();
  const grid = useSlotGrid(maxPlayers);
  return (
    <Box role="status" aria-busy="true" aria-label={t("ngLoading")} data-testid="next-game-skeleton" sx={{ maxWidth: "32rem" }}>
      <Box sx={{ ...bar("30%", 22), maxWidth: 140 }} />
      <Box sx={{ ...bar("65%", 42), maxWidth: 300, mt: "2px" }} />
      {!headerOnly && <Box sx={{ ...bar("100%", 56), borderRadius: 999, mt: 2 }} />}
      {!headerOnly && (
        <Box ref={grid.wrapRef} sx={{ mt: 2.5 }}>
          <Box sx={grid.gridSx}>
            {Array.from({ length: maxPlayers }, (_, i) => (
              <Box key={i} data-testid="skeleton-slot" sx={{ gridRow: grid.rowOf[i] + 1, gridColumn: grid.colOf[i] + 1, aspectRatio: "1", borderRadius: "50%", bgcolor: "action.hover" }} />
            ))}
          </Box>
        </Box>
      )}
      {!headerOnly && <Box sx={{ ...bar("80%", 21), mt: 1.25 }} />}
    </Box>
  );
}
