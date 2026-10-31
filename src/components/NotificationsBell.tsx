import { useEffect, useState } from "react";
import { Badge, IconButton, Tooltip } from "@mui/material";
import NotificationsIcon from "@mui/icons-material/Notifications";
import { useT } from "~/lib/useT";
import { NOTIFICATIONS_CHANGED } from "~/lib/notificationEvents";
import { apiRequest } from "~/lib/api/client";

/**
 * The bell. In-app notifications were already written and read by Android; the
 * web had no surface for them, so a player learned about a captain nomination
 * only by visiting the season page (#1560).
 *
 * It renders nothing for a signed-out visitor: the feed is per user and the
 * endpoint answers 401.
 */
export default function NotificationsBell({ signedIn }: { signedIn: boolean }) {
  const t = useT();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    const refresh = () => {
      apiRequest("GET /api/me/notifications", { query: { limit: 1 } })
        .then((body) => {
          const count = (body as { unreadCount?: number }).unreadCount;
          if (!cancelled && typeof count === "number") setUnread(count);
        })
        .catch(() => {});
    };
    refresh();
    // Marking read happens on the page, in a sibling component: the page
    // announces it rather than both sharing a store (#1560 review).
    window.addEventListener(NOTIFICATIONS_CHANGED, refresh);
    return () => {
      cancelled = true;
      window.removeEventListener(NOTIFICATIONS_CHANGED, refresh);
    };
  }, [signedIn]);

  if (!signedIn) return null;

  return (
    <Tooltip title={t("notifications")}>
      <IconButton color="inherit" component="a" href="/notifications" aria-label={t("notifications")}>
        <Badge badgeContent={unread} color="error" overlap="circular">
          <NotificationsIcon />
        </Badge>
      </IconButton>
    </Tooltip>
  );
}
