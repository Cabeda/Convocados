import { Redirect } from "expo-router";
import { useAuth } from "~/hooks/useAuth";
import { LoginScreen } from "~/screens/LoginScreen";

export default function Index() {
  const { isLoading, isAuthenticated } = useAuth();

  if (isLoading) return null; // splash screen handles this

  if (!isAuthenticated) return <LoginScreen />;

  return <Redirect href="/(tabs)/games" />;
}
