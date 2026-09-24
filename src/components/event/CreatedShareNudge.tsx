import { useState } from "react";
import { InviteShareDialog } from "./InviteShareDialog";

/**
 * Post-create share nudge (#1166). When the page loads with `?created=1` (a
 * game was just added), it opens the share dialog once so the creator
 * immediately sends the link to their group. The param is stripped from the
 * URL so it never re-fires on reload or share.
 */
export function CreatedShareNudge({ title }: { title: string }) {
  const [open, setOpen] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get("created") !== "1") return false;
      params.delete("created");
      const qs = params.toString();
      window.history.replaceState(null, "", window.location.pathname + (qs ? `?${qs}` : ""));
      return true;
    } catch {
      return false;
    }
  });

  if (!open) return null;

  const url =
    typeof window !== "undefined" ? window.location.origin + window.location.pathname : "";
  return <InviteShareDialog open name={title} url={url} onClose={() => setOpen(false)} />;
}
