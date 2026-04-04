/**
 * Push notification hook — dual delivery: Expo Push + ntfy (FOSS).
 *
 * 1. Expo Push: registers FCM/APNs token with the server (requires dev build + Google Play)
 * 2. ntfy: subscribes to a per-user ntfy topic via SSE (works everywhere, no Google dependency)
 *
 * The ntfy path is the FOSS-friendly default. Expo Push is a bonus for devices with Google Play.
 */
import { useEffect, useRef } from "react";
import { AppState, Platform } from "react-native";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { registerPushToken, unregisterPushToken } from "~/api/endpoints";
import { apiFetch } from "~/api/client";
import { useAuth } from "./useAuth";

// Flag to track if Expo push is available (not available in Expo Go SDK 53+)
let expoPushAvailable = true;

try {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
} catch {
  expoPushAvailable = false;
}

// ── Expo Push (optional — requires Google Play Services) ──────────────────

async function getExpoPushToken(): Promise<string | null> {
  if (!expoPushAvailable || !Device.isDevice) return null;

  try {
    const { status: existing } = await Notifications.getPermissionsAsync();
    let finalStatus = existing;

    if (existing !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== "granted") return null;

    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "Default",
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: "#1b6b4a",
      });
    }

    const tokenData = await Notifications.getExpoPushTokenAsync();
    return tokenData.data;
  } catch {
    expoPushAvailable = false;
    return null;
  }
}

// ── ntfy Push (FOSS — works without Google Play Services) ─────────────────

async function fetchNtfyTopicUrl(): Promise<string | null> {
  try {
    const res = await apiFetch("/api/push/ntfy-topic");
    if (!res.ok) return null;
    const data = await res.json();
    return data.sseUrl ?? null;
  } catch {
    return null;
  }
}

/**
 * Subscribe to a ntfy topic via EventSource (SSE).
 * Shows local notifications when messages arrive.
 * Returns an abort function to close the connection.
 */
function subscribeToNtfy(sseUrl: string): () => void {
  let aborted = false;
  let retryTimeout: ReturnType<typeof setTimeout> | null = null;

  async function connect() {
    if (aborted) return;

    try {
      // Use fetch with streaming for SSE (EventSource not available in RN)
      const res = await fetch(sseUrl, {
        headers: { Accept: "text/event-stream" },
      });

      if (!res.ok || !res.body) return;

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (!aborted) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const msg = JSON.parse(line.slice(6));
            if (msg.event === "message" || msg.message) {
              await Notifications.scheduleNotificationAsync({
                content: {
                  title: msg.title ?? "Convocados",
                  body: msg.message ?? msg.body ?? "",
                  data: { url: msg.click ?? "" },
                },
                trigger: null, // immediate
              });
            }
          } catch {
            // Ignore malformed SSE data
          }
        }
      }
    } catch {
      // Connection lost, will retry after delay
    }

    // Reconnect after 10s if not aborted
    if (!aborted) {
      retryTimeout = setTimeout(connect, 10_000);
    }
  }

  connect();

  return () => {
    aborted = true;
    if (retryTimeout) clearTimeout(retryTimeout);
  };
}

// ── Hook ──────────────────────────────────────────────────────────────────

export function usePushNotifications() {
  const { isAuthenticated } = useAuth();
  const expoTokenRef = useRef<string | null>(null);
  const ntfyCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!isAuthenticated) {
      // Cleanup on logout
      if (expoTokenRef.current) {
        unregisterPushToken(expoTokenRef.current).catch(() => {});
        expoTokenRef.current = null;
      }
      if (ntfyCleanupRef.current) {
        ntfyCleanupRef.current();
        ntfyCleanupRef.current = null;
      }
      return;
    }

    // Register Expo Push (optional — gracefully degrades)
    (async () => {
      const token = await getExpoPushToken();
      if (token) {
        expoTokenRef.current = token;
        const platform = Platform.OS === "ios" ? "ios" : "android";
        await registerPushToken(token, platform).catch(() => {});
      }
    })();

    // Subscribe to ntfy (FOSS — works everywhere)
    (async () => {
      const sseUrl = await fetchNtfyTopicUrl();
      if (sseUrl) {
        ntfyCleanupRef.current = subscribeToNtfy(sseUrl);
      }
    })();

    // Reconnect ntfy when app comes to foreground
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active" && isAuthenticated && !ntfyCleanupRef.current) {
        (async () => {
          const sseUrl = await fetchNtfyTopicUrl();
          if (sseUrl) {
            ntfyCleanupRef.current = subscribeToNtfy(sseUrl);
          }
        })();
      }
    });

    return () => {
      subscription.remove();
      if (ntfyCleanupRef.current) {
        ntfyCleanupRef.current();
        ntfyCleanupRef.current = null;
      }
    };
  }, [isAuthenticated]);

  return { expoToken: expoTokenRef.current };
}
