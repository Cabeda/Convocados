/**
 * Push notification registration hook.
 *
 * Registers the Expo push token with the server on login,
 * and unregisters on logout.
 *
 * Note: Push notifications don't work in Expo Go (SDK 53+).
 * They require a development build. The hook gracefully degrades.
 */
import { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { registerPushToken, unregisterPushToken } from "~/api/endpoints";
import { useAuth } from "./useAuth";

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

    const tokenData = await Notifications.getExpoPushTokenAsync();
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
      await registerPushToken(token, platform).catch(() => {});
    })();
  }, [isAuthenticated]);

  return { token: tokenRef.current };
}
