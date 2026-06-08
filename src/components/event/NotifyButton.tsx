import React, { useState, useEffect } from "react";
import { Button, Tooltip } from "@mui/material";
import NotificationsIcon from "@mui/icons-material/Notifications";
import NotificationsOffIcon from "@mui/icons-material/NotificationsOff";
import NotificationsNoneIcon from "@mui/icons-material/NotificationsNone";
import { useT } from "~/lib/useT";

interface Props {
  eventId: string;
  isAuthenticated: boolean;
}

export function NotifyButton({ eventId, isAuthenticated }: Props) {
  const t = useT();
  const [following, setFollowing] = useState(false);
  const [pushDenied, setPushDenied] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) return;
    fetch(`/api/events/${eventId}/follow`).then(r => r.json()).then(d => setFollowing(d.following)).catch(() => {});
    if ("Notification" in window && Notification.permission === "denied") setPushDenied(true);
  }, [eventId, isAuthenticated]);

  const handleFollow = async () => {
    setLoading(true);
    try {
      await fetch(`/api/events/${eventId}/follow`, { method: "POST" });
      setFollowing(true);

      // Also subscribe this device to push if possible
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
        } catch { /* push permission denied or unavailable — follow still worked */ }
      }
    } finally {
      setLoading(false);
    }
  };

  const handleUnfollow = async () => {
    setLoading(true);
    try {
      await fetch(`/api/events/${eventId}/follow`, { method: "DELETE" });
      setFollowing(false);
    } finally {
      setLoading(false);
    }
  };

  if (!isAuthenticated) return null;

  if (pushDenied && !following) return (
    <Tooltip title={t("notifyDenied")}>
      <span>
        <Button variant="outlined" size="small" disabled startIcon={<NotificationsOffIcon />} sx={{ flexShrink: 0 }}>
          {t("notifyDenied")}
        </Button>
      </span>
    </Tooltip>
  );

  if (following) return (
    <Button variant="outlined" size="small" color="success" startIcon={<NotificationsIcon />}
      onClick={handleUnfollow} disabled={loading} sx={{ flexShrink: 0 }}>
      {t("notifyEnabled")}
    </Button>
  );

  return (
    <Button variant="outlined" size="small" startIcon={<NotificationsNoneIcon />}
      onClick={handleFollow} disabled={loading} sx={{ flexShrink: 0 }}>
      {t("notifySubscribe")}
    </Button>
  );
}
