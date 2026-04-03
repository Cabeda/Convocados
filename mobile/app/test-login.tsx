/**
 * Test-only login route.
 * Accepts a one-time code via deep link and exchanges it for tokens.
 *
 * Deep link: exp://localhost:8081/--/test-login?code=xxx
 */
import { useEffect } from "react";
import { View, Text, ActivityIndicator, StyleSheet } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { setTokens, getServerUrl } from "~/auth/storage";
import { useAuth } from "~/hooks/useAuth";

export default function TestLogin() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const router = useRouter();
  const { refresh } = useAuth();

  useEffect(() => {
    if (!code) return;

    (async () => {
      try {
        const serverUrl = await getServerUrl();
        const res = await fetch(`${serverUrl}/api/auth/mobile-callback`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "Failed" }));
          console.error("Test login failed:", err);
          return;
        }

        const data = await res.json();
        await setTokens({
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
          expiresAt: Date.now() + data.expires_in * 1000,
        });

        // Refresh auth state then navigate to main app
        await refresh();
        router.replace("/");
      } catch (e) {
        console.error("Test login error:", e);
      }
    })();
  }, [code]);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color="#7edcab" />
      <Text style={styles.text}>Logging in...</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#111412",
    justifyContent: "center",
    alignItems: "center",
  },
  text: {
    color: "#c2c9c1",
    marginTop: 16,
    fontSize: 16,
  },
});
