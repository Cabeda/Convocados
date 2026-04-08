/**
 * Push notification registration hook.
 *
 * Registers the Expo push token with the server on login,
 * and unregisters on logout.
 *
 * Also handles:
 * - Deep linking when a notification is tapped
 * - Re-registering the token on app foreground (token rotation)
 *
 * Note: Push notifications don't work in Expo Go (SDK 53+).
 * They require a development build. The hook gracefully degrades.
 */
import { useEffect, useRef } from "react";
import { Platform, AppState } from "react-native";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { router } from "expo-router";
import { registerPushToken, unregisterPushToken } from "~/api/endpoints";
import { useAuth } from "./useAuth";
import { getStoredLocale, detectDeviceLocale } from "~/lib/i18n";

// Flag to track if push is available (not available in Expo Go SDK 53+)
let pushAvailable = true;

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
  pushAvailable = false;
}

async function getExpoPushToken(): Promise<string | null> {
  if (!pushAvailable || !Device.isDevice) return null;

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

    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      Constants.easConfig?.projectId;
    const tokenData = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    return tokenData.data;
  } catch {
    // Push not supported in this environment (Expo Go SDK 53+)
    pushAvailable = false;
    return null;
  }
}

export function usePushNotifications() {
  const { isAuthenticated } = useAuth();
  const tokenRef = useRef<string | null>(null);

  // Register/unregister token based on auth state
  useEffect(() => {
    if (!isAuthenticated) {
      if (tokenRef.current) {
        unregisterPushToken(tokenRef.current).catch(() => {});
        tokenRef.current = null;
      }
      return;
    }

    (async () => {
      const token = await getExpoPushToken();
      if (!token) return;

      tokenRef.current = token;
      const platform = Platform.OS === "ios" ? "ios" : "android";
      const locale = (await getStoredLocale()) ?? detectDeviceLocale();
      await registerPushToken(token, platform, locale).catch(() => {});
    })();
  }, [isAuthenticated]);

  // Re-register token on app foreground to handle token rotation
  useEffect(() => {
    if (!isAuthenticated) return;

    const subscription = AppState.addEventListener("change", async (state) => {
      if (state !== "active") return;
      const token = await getExpoPushToken();
      if (!token) return;
      // Only re-register if token changed
      if (token !== tokenRef.current) {
        tokenRef.current = token;
        const platform = Platform.OS === "ios" ? "ios" : "android";
        const locale = (await getStoredLocale()) ?? detectDeviceLocale();
        await registerPushToken(token, platform, locale).catch(() => {});
      }
    });

    return () => subscription.remove();
  }, [isAuthenticated]);

  // Handle notification tap — deep link to the event
  useEffect(() => {
    if (!pushAvailable) return;

    const subscription = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const url = response.notification.request.content.data?.url as
          | string
          | undefined;
        if (!url) return;
        // Server sends /events/:id but mobile route is /event/:id
        const match = url.match(/^\/events\/(.+)/);
        if (match) {
          router.push(`/event/${match[1]}` as any);
        }
      },
    );

    return () => subscription.remove();
  }, [router]);

  return { token: tokenRef.current };
}
