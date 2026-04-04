import { Slot } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import * as SplashScreen from "expo-splash-screen";
import { AuthProvider, useAuth } from "~/hooks/useAuth";
import { usePushNotifications } from "~/hooks/usePushNotifications";

// Keep splash screen visible while loading
SplashScreen.preventAutoHideAsync().catch(() => {});

function PushRegistrar() {
  usePushNotifications();
  return null;
}

function AppReady({ children }: { children: React.ReactNode }) {
  const { isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [isLoading]);

  return <>{children}</>;
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <AppReady>
        <PushRegistrar />
        <StatusBar style="light" />
        <Slot />
      </AppReady>
    </AuthProvider>
  );
}
