import { Box } from "@mui/material";
import { useT } from "~/lib/useT";
import { BOARD_MAX_WIDTH } from "./styles";

const bar = (w: string | number, h: string | number) => ({ width: w, height: h, borderRadius: 1, bgcolor: "action.hover", flex: "none" });

/**
 * The recap before its data is in: the same card with the scoreboard and two
 * rows as quiet bars (or the one-line strip), so the page below does not move
 * when the real card replaces it.
 */
export function RecapSkeleton({ strip = false }: { strip?: boolean }) {
  const t = useT();
  return (
    <Box
      role="status" aria-busy="true" aria-label={t("recapLoading")} data-testid="recap-skeleton"
      sx={{ bgcolor: "background.paper", border: 1, borderColor: "divider", borderRadius: "20px", overflow: "hidden" }}
    >
      {strip ? (
        <Box sx={{ px: 2, py: 1, minHeight: 66, display: "flex", flexDirection: "column", justifyContent: "center", gap: 0.75 }}>
          <Box sx={bar("60%", 28)} /><Box sx={bar("40%", 14)} />
        </Box>
      ) : (
        <>
          <Box sx={{ px: 2, pt: 1.5, pb: 2.5 }}>
            <Box sx={{ ...bar("35%", 16), mb: 1.5 }} />
            <Box sx={{ maxWidth: BOARD_MAX_WIDTH, mx: "auto", display: "flex", justifyContent: "space-between", alignItems: "end" }}>
              <Box sx={bar("3.5rem", "4.75rem")} /><Box sx={bar("3.5rem", "4.75rem")}
              />
            </Box>
            <Box sx={{ ...bar("50%", 18), mt: 1.5 }} />
          </Box>
          {[0, 1].map((i) => (
            <Box key={i} sx={{ borderTop: 1, borderColor: "divider", minHeight: 64, px: 2, display: "flex", alignItems: "center", gap: 1.5 }}>
              <Box sx={{ ...bar(12, 12), borderRadius: "50%" }} />
              <Box sx={{ flex: 1, display: "grid", gap: 0.75 }}><Box sx={bar("55%", 16)} /><Box sx={bar("75%", 12)} /></Box>
              <Box sx={{ ...bar(96, 48), borderRadius: 999 }} />
            </Box>
          ))}
        </>
      )}
    </Box>
  );
}
