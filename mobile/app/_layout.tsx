import { Slot } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { AuthProvider } from "~/hooks/useAuth";
import { usePushNotifications } from "~/hooks/usePushNotifications";

function PushRegistrar() {
  usePushNotifications();
  return null;
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <PushRegistrar />
      <StatusBar style="light" />
      <Slot />
    </AuthProvider>
  );
}
