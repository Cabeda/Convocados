import { Redirect } from "expo-router";
import { View, ActivityIndicator } from "react-native";
import { useAuth } from "~/hooks/useAuth";
import { LoginScreen } from "~/screens/LoginScreen";
import { colors } from "~/lib/theme";

export default function Index() {
  const { isLoading, isAuthenticated } = useAuth();

  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!isAuthenticated) return <LoginScreen />;

  return <Redirect href="/(tabs)/games" />;
}
