import React, { useState, useEffect } from "react";
import { Alert, Button, Collapse } from "@mui/material";
import NotificationsIcon from "@mui/icons-material/Notifications";
import { useT } from "~/lib/useT";

const DISMISS_KEY = "push_prompt_dismissed_at";
const COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

interface Props {
  followCount: number;
}

/**
 * Non-intrusive banner prompting the user to enable push notifications on this device.
 * Shown when: follows >= 1 game, no PushSubscription on device, not dismissed in 30 days.
 */
export function PushPromptBanner({ followCount }: Props) {
  const t = useT();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (followCount < 1) return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
    if (Notification.permission === "denied" || Notification.permission === "granted") return;

    // Check cooldown
    const dismissed = localStorage.getItem(DISMISS_KEY);
    if (dismissed && Date.now() - Number(dismissed) < COOLDOWN_MS) return;

    // Check if device already has a subscription
    navigator.serviceWorker.ready.then((reg) => {
      reg.pushManager.getSubscription().then((sub) => {
        if (!sub) setVisible(true);
      });
    });
  }, [followCount]);

  const handleEnable = async () => {
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
      setVisible(false);
    } catch {
      // User denied or error — dismiss
      setVisible(false);
    }
  };

  const handleDismiss = () => {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setVisible(false);
  };

  return (
    <Collapse in={visible}>
      <Alert
        severity="info"
        icon={<NotificationsIcon />}
        action={
          <>
            <Button color="inherit" size="small" onClick={handleEnable}>
              {t("enable")}
            </Button>
            <Button color="inherit" size="small" onClick={handleDismiss}>
              {t("dismiss")}
            </Button>
          </>
        }
        sx={{ mb: 2 }}
      >
        {t("pushPromptBanner")}
      </Alert>
    </Collapse>
  );
}
