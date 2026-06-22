import React, { useState, useEffect } from "react";
import { Alert, Button, Collapse, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Link, Snackbar } from "@mui/material";
import NotificationsIcon from "@mui/icons-material/Notifications";
import BlockIcon from "@mui/icons-material/Block";
import { useT } from "~/lib/useT";
import { resolveIosHelpLink } from "~/lib/pushPrompt";

const DISMISS_KEY = "push_prompt_dismissed_at";
const COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000; // 14 days (tightened from 30d after #463)

interface Props {
  followCount: number;
  /** #457: event-detail trigger. When true, suppress the followCount gate. */
  forceOnEventDetail?: boolean;
  /** #463 high-intent: user has a pending RSVP for an event <48h away.
   *  Renders as a centered modal Dialog instead of a banner — harder to ignore. */
  highIntent?: boolean;
  /** Optional callback fired after a successful enable, e.g. to surface a
   *  dashboard-level Snackbar. Receives `{ delivered, total }` from the
   *  server's test-push response. */
  onEnabled?: (result: { delivered: number; total: number }) => void;
}

/**
 * Non-intrusive banner prompting the user to enable push notifications on this device.
 * #457: four-state model — granted/denied/dismissed/default. Denied is terminal and
 * renders a "blocked" hint with browser-settings instructions instead of re-prompting.
 * #463 escalation: high-intent surfaces render as a modal Dialog, not a banner.
 * #136: on successful enable, fires a test push so the user gets an instant
 *   "it works" moment, and surfaces the result via Snackbar.
 */
export function PushPromptBanner({ followCount, forceOnEventDetail = false, highIntent = false, onEnabled }: Props) {
  const t = useT();
  const [visible, setVisible] = useState(false);
  const [denied, setDenied] = useState(false);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: "success" | "error" }>({
    open: false,
    message: "",
    severity: "success",
  });

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

    // Check cooldown (14 days since last in-app dismiss)
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

      // #136: send a self-test push so the user gets immediate confirmation
      // the channel works. Snackbar doubles as a UX moment AND a fallback
      // when the OS suppressed the notification.
      let result: { delivered: number; total: number } = { delivered: 0, total: 0 };
      try {
        const r = await fetch("/api/push/test", { method: "POST" });
        if (r.ok) result = await r.json();
      } catch { /* network blip — non-fatal */ }

      if (onEnabled) onEnabled(result);

      if (result.total === 0) {
        // No subscriptions registered server-side (race or older client) — still
        // tell the user it worked, since the browser-level permission succeeded.
        setSnackbar({ open: true, message: t("pushTestSent"), severity: "success" });
      } else if (result.delivered > 0) {
        setSnackbar({ open: true, message: t("pushTestSent"), severity: "success" });
      } else {
        setSnackbar({ open: true, message: t("pushTestFailed"), severity: "error" });
      }
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
    const helpHref = resolveIosHelpLink(ua);
    const isIos = /iPhone|iPad|iPod/.test(ua) && !/MSStream/.test(ua);
    return (
      <>
        <Alert severity="warning" icon={<BlockIcon />} sx={{ mb: 2 }}>
          {(isIos ? t("pushBlockedIosHint") : t("pushBlockedHint"))}{" "}
          <Link href={helpHref} target="_blank" rel="noopener">
            {t("enable")}
          </Link>
        </Alert>
        <Snackbar
          open={snackbar.open}
          autoHideDuration={4000}
          onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
          message={snackbar.message}
        />
      </>
    );
  }

  // #463 high-intent: render as a centered modal Dialog — harder to ignore
  // when the user has a pending RSVP for a near-term event.
  if (highIntent && visible) {
    return (
      <>
        <Dialog open onClose={handleDismiss} maxWidth="xs" fullWidth>
          <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <NotificationsIcon color="primary" />
            {t("pushPromptTitle")}
          </DialogTitle>
          <DialogContent>
            <DialogContentText>{t("pushPromptHighIntentBody")}</DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button onClick={handleDismiss} color="inherit">{t("dismiss")}</Button>
            <Button onClick={handleEnable} variant="contained" color="primary">{t("enable")}</Button>
          </DialogActions>
        </Dialog>
        <Snackbar
          open={snackbar.open}
          autoHideDuration={4000}
          onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
          message={snackbar.message}
        />
      </>
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
      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
        message={snackbar.message}
      />
    </Collapse>
  );
}
