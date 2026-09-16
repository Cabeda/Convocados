/**
 * Device-level push state.
 *
 * Distinguishes the push channel of the *current browser/device* from the
 * user's account-level preference. A device can be unable to receive push
 * even when the account toggle is on (iOS in a Safari tab, permission
 * blocked, or simply never subscribed).
 *
 * Pure detection helpers live here so both the notifications dialog and the
 * follow button reason about device state the same way.
 */
import { isIos as uaIsIos, isStandalone as resolveStandalone } from "./pushPrompt";

export type DevicePushState =
  /** No Push API in this browser at all. */
  | "unsupported"
  /** iOS Safari tab: push only works once the PWA is added to the Home Screen. */
  | "needs-install"
  /** Permission denied in browser settings — terminal. */
  | "blocked"
  /** Supported and available, but this device has no subscription yet. */
  | "off"
  /** This device has an active push subscription. */
  | "on";

export type PushPermission = "default" | "granted" | "denied";

export interface DevicePushInput {
  supported: boolean;
  isIos: boolean;
  isStandalone: boolean;
  permission: PushPermission;
  hasSubscription: boolean;
}

/** Resolve the device push state from a snapshot of browser capabilities. */
export function detectDevicePushState(input: DevicePushInput): DevicePushState {
  if (!input.supported) return "unsupported";
  // On iOS the Web Push API is only exposed to home-screen web apps. In a
  // Safari tab push is unusable regardless of the permission value, so the
  // install prerequisite takes precedence over "blocked".
  if (input.isIos && !input.isStandalone) return "needs-install";
  if (input.permission === "denied") return "blocked";
  if (input.hasSubscription) return "on";
  return "off";
}

/**
 * Decode a base64url-encoded VAPID public key into the raw bytes expected by
 * `PushManager.subscribe`. Handles missing padding and url-safe characters.
 */
export function base64UrlToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  if (!normalized) return new Uint8Array(new ArrayBuffer(0));
  const raw = atob(normalized);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** True when this browser exposes the Service Worker + Push APIs. */
export function isPushSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator &&
    typeof window !== "undefined" &&
    "PushManager" in window
  );
}

/** Snapshot the platform facts needed to classify this device. */
export function readDeviceContext(): {
  supported: boolean;
  isIos: boolean;
  isStandalone: boolean;
  permission: PushPermission;
} {
  const supported = isPushSupported();
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const ios = uaIsIos(ua);
  const standalone =
    typeof window !== "undefined" &&
    resolveStandalone({
      displayModeStandalone: window.matchMedia?.("(display-mode: standalone)").matches ?? false,
      navigatorStandalone: (navigator as unknown as { standalone?: boolean }).standalone,
    });
  const permission: PushPermission =
    typeof Notification !== "undefined" ? Notification.permission : "default";
  return { supported, isIos: ios, isStandalone: standalone, permission };
}

/** Classify the current device, including whether it already has a subscription. */
export async function detectCurrentDevicePushState(): Promise<DevicePushState> {
  const ctx = readDeviceContext();
  if (!ctx.supported) return detectDevicePushState({ ...ctx, hasSubscription: false });
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    return detectDevicePushState({ ...ctx, hasSubscription: !!sub });
  } catch {
    return detectDevicePushState({ ...ctx, hasSubscription: false });
  }
}

export interface DevicePushResult {
  ok: boolean;
  state: DevicePushState;
  reason?: "unsupported" | "needs-install" | "blocked" | "error";
}

/**
 * Subscribe *this device* to web push.
 *
 * Requests the notification permission first (before subscribing) so the
 * native prompt is anchored to the user's click — required on iOS — and so a
 * denial cannot leave a half-created subscription behind.
 */
export async function enableDevicePush(): Promise<DevicePushResult> {
  const ctx = readDeviceContext();
  if (!ctx.supported) return { ok: false, state: "unsupported", reason: "unsupported" };
  if (ctx.isIos && !ctx.isStandalone) return { ok: false, state: "needs-install", reason: "needs-install" };

  try {
    let permission = ctx.permission;
    if (permission === "default") {
      permission = await Notification.requestPermission();
    }
    if (permission !== "granted") {
      return { ok: false, state: "blocked", reason: "blocked" };
    }

    const reg = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
    const keyRes = await fetch("/api/push/vapid-public-key");
    const { publicKey } = await keyRes.json();
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToUint8Array(publicKey),
    });
    const res = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...sub.toJSON(), locale: navigator.language }),
    });
    if (!res.ok) {
      // The server never recorded it — roll back so the device doesn't show
      // "on" while no push can actually be delivered.
      await sub.unsubscribe().catch(() => {});
      throw new Error("Failed to register push subscription");
    }
    return { ok: true, state: "on" };
  } catch {
    return { ok: false, state: "off", reason: "error" };
  }
}

/** Unsubscribe *this device*, removing the server record and browser subscription. */
export async function disableDevicePush(): Promise<boolean> {
  if (!isPushSupported()) return false;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return true;
    // Browser first: once unsubscribed this device can no longer receive, so a
    // later server failure cannot leave the UI stuck on "on".
    await sub.unsubscribe();
    await fetch("/api/push/subscribe", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    });
    return true;
  } catch {
    return false;
  }
}
