import { useState, useEffect } from "react";
import { Button, Snackbar } from "@mui/material";
import BookmarkIcon from "@mui/icons-material/Bookmark";
import BookmarkBorderIcon from "@mui/icons-material/BookmarkBorder";
import { useT } from "~/lib/useT";
import { enableDevicePush } from "~/lib/devicePush";

interface Props {
  eventId: string;
  isAuthenticated: boolean;
}

/**
 * ponytail: Follow button — binary toggle for anyone who can access the event,
 * players included. Unfollowing is an explicit opt-out: it keeps the player's
 * spot on the roster but stops notifications (ADR 0003).
 * Follow = game appears in My Games + get event-change notifications.
 */
export function NotifyButton({ eventId, isAuthenticated }: Props) {
  const t = useT();
  const [following, setFollowing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated) return;
    fetch(`/api/events/${eventId}/follow`)
      .then((r) => r.json())
      .then((d) => {
        setFollowing(!!d.following);
      })
      .catch(() => {});
  }, [eventId, isAuthenticated]);

  const handleToggle = async () => {
    setLoading(true);
    try {
      if (following) {
        const res = await fetch(`/api/events/${eventId}/follow`, { method: "DELETE" });
        if (res.ok) {
          setFollowing(false);
          setToast(t("unfollowedToast"));
        }
      } else {
        const res = await fetch(`/api/events/${eventId}/follow`, { method: "POST" });
        if (res.ok) {
          setFollowing(true);
          setToast(t("followedToast"));

          // Subscribe this device to push. Requests the permission first and
          // reports every failure mode instead of dropping them silently.
          const pushResult = await enableDevicePush();
          if (pushResult.reason === "needs-install") {
            setToast(t("notifyDeviceNeedsInstall"));
          } else if (pushResult.reason === "blocked") {
            setToast(t("notifyDeviceBlocked"));
          } else if (pushResult.reason === "unsupported") {
            setToast(t("notifyDeviceUnsupported"));
          } else if (pushResult.reason === "error") {
            setToast(t("notifyPushEnableFailed"));
          }
        }
      }
    } finally {
      setLoading(false);
    }
  };

  // Hidden only for unauthenticated users. Everyone with access can follow,
  // including players (who can unfollow to opt out while keeping their spot).
  if (!isAuthenticated) return null;

  return (
    <>
      <Button
        variant={following ? "contained" : "outlined"}
        size="small"
        color={following ? "success" : "inherit"}
        startIcon={following ? <BookmarkIcon /> : <BookmarkBorderIcon />}
        onClick={handleToggle}
        disabled={loading}
        disableElevation
        sx={{ flexShrink: 0, borderRadius: 2, textTransform: "none", fontWeight: 600 }}
      >
        {following ? t("followingGame") : t("followGame")}
      </Button>
      <Snackbar
        open={!!toast}
        autoHideDuration={3000}
        onClose={() => setToast(null)}
        message={toast}
      />
    </>
  );
}
