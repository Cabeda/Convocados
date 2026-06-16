import React, { useState, useEffect } from "react";
import { Alert, Button, Collapse, Link } from "@mui/material";
import NotificationsIcon from "@mui/icons-material/Notifications";
import BlockIcon from "@mui/icons-material/Block";
import { useT } from "~/lib/useT";

const DISMISS_KEY = "push_prompt_dismissed_at";
const COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

interface Props {
  followCount: number;
  /** #457: event-detail trigger. When true, suppress the followCount gate. */
  forceOnEventDetail?: boolean;
}

/**
 * Non-intrusive banner prompting the user to enable push notifications on this device.
 * #457: four-state model — granted/denied/dismissed/default. Denied is terminal and
 * renders a "blocked" hint with browser-settings instructions instead of re-prompting.
 */
export function PushPromptBanner({ followCount, forceOnEventDetail = false }: Props) {
  const t = useT();
  const [visible, setVisible] = useState(false);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;

    if (Notification.permission === "denied") {
      // #457: terminal — never re-trigger native prompt. Show hint instead.
      setDenied(true);
      return;
    }
    if (Notification.permission === "granted") return;

    if (!forceOnEventDetail && followCount < 1) return;

    // Check cooldown (30 days since last in-app dismiss)
    const dismissed = localStorage.getItem(DISMISS_KEY);
    if (dismissed && Date.now() - Number(dismissed) < COOLDOWN_MS) return;

    navigator.serviceWorker.ready.then((reg) => {
      reg.pushManager.getSubscription().then((sub) => {
        if (!sub) setVisible(true);
      });
    });
  }, [followCount, forceOnEventDetail]);

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
      await fetch("/api/users/me/push-prompt-state", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: "granted" }),
      }).catch(() => {});
      setVisible(false);
    } catch {
      // User denied or error — record dismissal
      handleDismiss();
    }
  };

  const handleDismiss = () => {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    fetch("/api/users/me/push-prompt-state", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: "dismissed" }),
    }).catch(() => {});
    setVisible(false);
  };

  if (denied) {
    const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
    const helpHref = /Firefox/i.test(ua)
      ? "about:preferences#content-notifications"
      : /Chrome|Edg/i.test(ua)
        ? "chrome://settings/content/notifications"
        : "/docs/push";
    return (
      <Alert severity="warning" icon={<BlockIcon />} sx={{ mb: 2 }}>
        {t("pushBlockedHint")}{" "}
        <Link href={helpHref} target="_blank" rel="noopener">
          {t("enable")}
        </Link>
      </Alert>
    );
  }

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
