import { useCallback, useState } from "react";
import { Snackbar } from "@mui/material";
import { useFixedBottomBanner } from "~/lib/bottomSlot";

/**
 * The header's one toast system: messages wait in line and show one after the other,
 * so a second message never wipes out the first before anyone could read it.
 */
export function useHeaderToasts() {
  const [queue, setQueue] = useState<string[]>([]);
  const push = useCallback((message: string) => setQueue((q) => (q[q.length - 1] === message ? q : [...q, message])), []);
  const next = useCallback(() => setQueue((q) => q.slice(1)), []);
  return { queue, push, next };
}

/** One quiet line at the bottom for what a header action just did. Announced politely, not as an alert. */
export function HeaderToast({ queue, onDone }: { queue: string[]; onDone: () => void }) {
  // An update or install banner is fixed to the same edge and sits above a toast: the toast rides over it, never under it.
  const banner = useFixedBottomBanner();
  return (
    <Snackbar
      sx={banner ? { bottom: "calc(6rem + env(safe-area-inset-bottom))" } : undefined}
      key={queue[0]}
      open={queue.length > 0} message={queue[0]} autoHideDuration={4000}
      onClose={(_, reason) => { if (reason !== "clickaway") onDone(); }}
      anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      slotProps={{ content: { role: "status" } }}
    />
  );
}
