import { useEffect, useState } from "react";
import { Box, Typography } from "@mui/material";
import { useLocale } from "~/lib/useT";
import { EASE } from "./styles";

const CALM = "@media (prefers-reduced-motion: reduce)";
const LEAVE_MS = 220;

/**
 * One quiet line under the header while the page cannot reach the server.
 * It takes no room when everything is fine: it grows in when the connection is
 * lost and folds away when it comes back (a transform-free height animation on
 * a grid row, instant for people who asked for less motion).
 */
export function OfflineNotice({ since }: { since: number | null }) {
  const { locale, t } = useLocale();
  const [shownSince, setShownSince] = useState<number | null>(since);
  const [leaving, setLeaving] = useState(false);

  if (since !== null && (shownSince !== since || leaving)) { setShownSince(since); setLeaving(false); }
  if (since === null && shownSince !== null && !leaving) setLeaving(true);

  useEffect(() => {
    if (!leaving) return;
    const id = setTimeout(() => { setShownSince(null); setLeaving(false); }, LEAVE_MS);
    return () => clearTimeout(id);
  }, [leaving]);

  // The live region is always on the page (a region that appears already full is not reliably announced).
  if (shownSince === null) return <Box role="status" data-testid="offline-status" />;
  const time = new Date(shownSince).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  return (
    <Box role="status" data-testid="offline-status">
      <Box
        data-testid="offline-notice"
        sx={{
          display: "grid", gridTemplateRows: leaving ? "0fr" : "1fr", opacity: leaving ? 0 : 1,
          transition: `grid-template-rows ${LEAVE_MS}ms ${EASE}, opacity ${LEAVE_MS}ms ${EASE}`,
          animation: `offlineIn ${LEAVE_MS}ms ${EASE}`,
          "@keyframes offlineIn": { from: { gridTemplateRows: "0fr", opacity: 0 }, to: { gridTemplateRows: "1fr", opacity: 1 } },
          [CALM]: { animation: "none", transition: "none" },
        }}
      >
        <Box sx={{ overflow: "clip", minHeight: 0 }}>
          <Typography sx={{ pt: 1, fontSize: "0.9375rem", lineHeight: 1.4, color: "text.secondary", textWrap: "pretty" }}>
            {t("offlineShowing", { time })}
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}
