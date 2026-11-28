import { Box, Typography } from "@mui/material";
import { useT } from "~/lib/useT";

/** The game is off. Plain words, a bar in the error colour on the left, and what happens next. */
export function CancelledBanner({ canManage }: { canManage: boolean }) {
  const t = useT();
  return (
    <Box component="section" aria-labelledby="cancelled-title" sx={{ borderLeft: "4px solid", borderColor: "error.main", pl: 2, py: 0.5 }}>
      <Typography id="cancelled-title" component="h2" sx={{ fontSize: "1.0625rem", fontWeight: 700, lineHeight: 1.3 }}>
        {t("cancelledTitle")}
      </Typography>
      <Typography sx={{ fontSize: "1rem", color: "text.secondary", lineHeight: 1.4, textWrap: "pretty" }}>
        {t(canManage ? "cancelledBodyAdmin" : "cancelledBodyPlayer")}
      </Typography>
    </Box>
  );
}
