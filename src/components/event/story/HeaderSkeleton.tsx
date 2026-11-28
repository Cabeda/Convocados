import { Box } from "@mui/material";
import { useT } from "~/lib/useT";

const bar = (w: string | number, h: number) => ({ width: w, height: h, borderRadius: 1, bgcolor: "action.hover", flex: "none" });

/** The header before its data is in: the same rows at the same heights, so the page below does not move. */
export function HeaderSkeleton() {
  const t = useT();
  return (
    <Box role="status" aria-busy="true" aria-label={t("headerLoading")} data-testid="header-skeleton">
      <Box sx={{ minHeight: 44, display: "flex", alignItems: "center", gap: 0.5 }}>
        <Box sx={bar("55%", 32)} />
        <Box sx={{ flex: 1 }} />
        {[0, 1].map((i) => <Box key={i} sx={{ ...bar(28, 28), borderRadius: "50%", mx: "8px" }} />)}
      </Box>
      <Box sx={{ mt: 0.5, display: "grid", gap: "2px" }}>
        <Box sx={{ ...bar("70%", 24), maxWidth: 320 }} />
        <Box sx={{ ...bar("50%", 24), maxWidth: 220 }} />
      </Box>
      <Box sx={{ mt: 0.5, minHeight: 44, display: "flex", alignItems: "center" }}>
        <Box sx={{ ...bar(120, 28), borderRadius: 999 }} />
      </Box>
    </Box>
  );
}
