import React, { useState, useEffect } from "react";
import { Button, Tooltip } from "@mui/material";
import NotificationsIcon from "@mui/icons-material/Notifications";
import NotificationsOffIcon from "@mui/icons-material/NotificationsOff";
import { useT } from "~/lib/useT";

interface Props {
  eventId: string;
}

export function NotifyButton({ eventId }: Props) {
  const t = useT();
  const [state, setState] = useState<"idle" | "subscribed" | "denied" | "unsupported">("idle");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setState("unsupported"); return;
    }
    if (Notification.permission === "denied") { setState("denied"); return; }
    navigator.serviceWorker.ready.then((reg) => {
      reg.pushManager.getSubscription().then((sub) => {
        if (sub) setState("subscribed");
      });
    });
  }, []);

  const subscribe = async () => {
    setLoading(true);
    try {
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const keyRes = await fetch("/api/push/vapid-public-key");
      const { publicKey } = await keyRes.json();
      // Firefox requires a Uint8Array; Chrome accepts strings too
      const padding = "=".repeat((4 - (publicKey.length % 4)) % 4);
      const base64 = (publicKey + padding).replace(/-/g, "+").replace(/_/g, "/");
      const raw = window.atob(base64);
      const key = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) key[i] = raw.charCodeAt(i);
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: key,
      });
      await fetch(`/api/events/${eventId}/push`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...sub.toJSON(),
          locale: navigator.language,
          clientId: localStorage.getItem("client_id") ?? "",
        }),
      });
      setState("subscribed");
    } catch {
      if (Notification.permission === "denied") setState("denied");
    } finally {
      setLoading(false);
    }
  };

  const unsubscribe = async () => {
    setLoading(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch(`/api/events/${eventId}/push`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setState("idle");
    } finally {
      setLoading(false);
    }
  };

  if (state === "unsupported") return null;

  if (state === "denied") return (
    <Tooltip title={t("notifyDenied")}>
      <span>
        <Button variant="outlined" size="small" disabled startIcon={<NotificationsOffIcon />} sx={{ flexShrink: 0 }}>
          {t("notifyDenied")}
        </Button>
      </span>
    </Tooltip>
  );

  if (state === "subscribed") return (
    <Button variant="outlined" size="small" color="success" startIcon={<NotificationsIcon />}
      onClick={unsubscribe} disabled={loading} sx={{ flexShrink: 0 }}>
      {t("notifyEnabled")}
    </Button>
  );

  return (
    <Button variant="outlined" size="small" startIcon={<NotificationsIcon />}
      onClick={subscribe} disabled={loading} sx={{ flexShrink: 0 }}>
      {t("notifySubscribe")}
    </Button>
  );
}
