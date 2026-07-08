import React, { useState, useEffect } from "react";
import { Button, Snackbar } from "@mui/material";
import BookmarkIcon from "@mui/icons-material/Bookmark";
import BookmarkBorderIcon from "@mui/icons-material/BookmarkBorder";
import { useT } from "~/lib/useT";

interface Props {
  eventId: string;
  isAuthenticated: boolean;
}

/**
 * ponytail: Follow button — simple binary toggle for non-players.
 * Players are auto-followed (button hidden for them).
 * Follow = game appears in My Games + get event-change notifications.
 */
export function NotifyButton({ eventId, isAuthenticated }: Props) {
  const t = useT();
  const [following, setFollowing] = useState(false);
  const [isPlayer, setIsPlayer] = useState(false);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated) return;
    fetch(`/api/events/${eventId}/follow`)
      .then((r) => r.json())
      .then((d) => {
        setFollowing(!!d.following);
        setIsPlayer(!!d.isPlayer);
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

          // Register push subscription silently on first follow
          if ("serviceWorker" in navigator && "PushManager" in window && Notification.permission !== "denied") {
            try {
              const reg = await navigator.serviceWorker.register("/sw.js");
              await navigator.serviceWorker.ready;
              const keyRes = await fetch("/api/push/vapid-public-key");
              const { publicKey } = await keyRes.json();
              const padding = "=".repeat((4 - (publicKey.length % 4)) % 4);
              const base64 = (publicKey + padding).replace(/-/g, "+").replace(/_/g, "/");
              const raw = window.atob(base64);
              const key = new Uint8Array(raw.length);
              for (let i = 0; i < raw.length; i++) key[i] = raw.charCodeAt(i);
              const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
              await fetch("/api/push/subscribe", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...sub.toJSON(), locale: navigator.language }),
              });
            } catch { /* push permission denied or unavailable — silent */ }
          }
        }
      }
    } finally {
      setLoading(false);
    }
  };

  // Hidden for unauthenticated users and players (players are auto-followed)
  if (!isAuthenticated || isPlayer) return null;

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
