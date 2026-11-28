import { useEffect, useRef, useState } from "react";
import { Button } from "@mui/material";
import BookmarkIcon from "@mui/icons-material/Bookmark";
import BookmarkBorderIcon from "@mui/icons-material/BookmarkBorder";
import { useT } from "~/lib/useT";
import { enableDevicePush } from "~/lib/devicePush";
import { apiRequest } from "~/lib/api/client";
import { textAction } from "./styles";

interface Props {
  eventId: string;
  onToast: (message: string) => void;
}

type Known = "loading" | "failed" | "ready";

/**
 * Follow = the game shows in My Games and its changes reach you. Unfollowing keeps a
 * player's spot on the roster and only stops the notifications (ADR 0003).
 * It reads "Follow game" or "Following", and stays disabled until the server has said which,
 * so a failed lookup never passes for "not following". A tap flips it at once and flips
 * back, with a plain sentence, if the server says no.
 */
export function FollowToggle({ eventId, onToast }: Props) {
  const t = useT();
  const [following, setFollowing] = useState(false);
  const [known, setKnown] = useState<Known>("loading");
  const busyRef = useRef(false);

  useEffect(() => {
    let alive = true;
    apiRequest("GET /api/events/{id}/follow", { params: { id: eventId } })
      .then((d) => { if (!alive) return; setFollowing(!!(d as { following?: boolean }).following); setKnown("ready"); })
      .catch(() => alive && setKnown("failed"));
    return () => { alive = false; };
  }, [eventId]);

  const toggle = async () => {
    if (busyRef.current || known !== "ready") return;
    busyRef.current = true;
    const next = !following;
    setFollowing(next);
    try {
      await apiRequest(next ? "POST /api/events/{id}/follow" : "DELETE /api/events/{id}/follow", { params: { id: eventId } });
      onToast(t(next ? "followedToast" : "unfollowedToast"));
      if (next) {
        // Subscribe this device to push: asks for permission and reports every failure mode.
        const { reason } = await enableDevicePush().catch(() => ({ reason: "error" as const }));
        const problem = { "needs-install": "notifyDeviceNeedsInstall", blocked: "notifyDeviceBlocked", unsupported: "notifyDeviceUnsupported", error: "notifyPushEnableFailed" } as const;
        if (reason && reason in problem) onToast(t(problem[reason as keyof typeof problem]));
      }
    } catch {
      setFollowing(!next);
      onToast(t(next ? "followFailed" : "unfollowFailed"));
    } finally {
      busyRef.current = false;
    }
  };

  return (
    <Button
      onClick={toggle} disabled={known !== "ready"} aria-busy={known === "loading"}
      title={known === "failed" ? t("followLoadFailed") : undefined}
      startIcon={following ? <BookmarkIcon /> : <BookmarkBorderIcon />}
      sx={{ ...textAction, color: following ? "primary.main" : "text.secondary" }}
    >
      {t(following ? "followingGame" : "followGame")}
    </Button>
  );
}
