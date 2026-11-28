import { useEffect, useRef, useState } from "react";
import { IconButton } from "@mui/material";
import BookmarkIcon from "@mui/icons-material/Bookmark";
import BookmarkBorderIcon from "@mui/icons-material/BookmarkBorder";
import { useT } from "~/lib/useT";
import { enableDevicePush } from "~/lib/devicePush";
import { apiRequest } from "~/lib/api/client";
import { iconAction } from "./styles";

interface Props {
  eventId: string;
  onToast: (message: string) => void;
}

/**
 * Follow = the game shows in My Games and its changes reach you. Unfollowing keeps a
 * player's spot on the roster and only stops the notifications (ADR 0003).
 * The bookmark flips the moment it is tapped and flips back, with a plain sentence, if the server says no.
 */
export function FollowToggle({ eventId, onToast }: Props) {
  const t = useT();
  const [following, setFollowing] = useState(false);
  const [ready, setReady] = useState(false);
  const busyRef = useRef(false);

  useEffect(() => {
    let alive = true;
    apiRequest("GET /api/events/{id}/follow", { params: { id: eventId } })
      .then((d) => alive && setFollowing(!!(d as { following?: boolean }).following))
      .catch(() => {})
      .finally(() => alive && setReady(true));
    return () => { alive = false; };
  }, [eventId]);

  const toggle = async () => {
    if (busyRef.current || !ready) return;
    busyRef.current = true;
    const next = !following;
    setFollowing(next);
    try {
      await apiRequest(next ? "POST /api/events/{id}/follow" : "DELETE /api/events/{id}/follow", { params: { id: eventId } });
      onToast(t(next ? "followedToast" : "unfollowedToast"));
      if (next) {
        // Subscribe this device to push: asks for permission and reports every failure mode.
        const { reason } = await enableDevicePush();
        const problem = { "needs-install": "notifyDeviceNeedsInstall", blocked: "notifyDeviceBlocked", unsupported: "notifyDeviceUnsupported", error: "notifyPushEnableFailed" } as const;
        if (reason && reason in problem) onToast(t(problem[reason as keyof typeof problem]));
      }
    } catch {
      setFollowing(!next);
      onToast(t("somethingWentWrong"));
    } finally {
      busyRef.current = false;
    }
  };

  return (
    <IconButton
      onClick={toggle} aria-pressed={following} aria-label={t("followGame")}
      sx={{ ...iconAction, color: following ? "primary.main" : "text.primary" }}
    >
      {following ? <BookmarkIcon /> : <BookmarkBorderIcon />}
    </IconButton>
  );
}
