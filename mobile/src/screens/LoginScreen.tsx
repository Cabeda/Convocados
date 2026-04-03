import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import { useState } from "react";
import { useAuth } from "~/hooks/useAuth";
import { useT } from "~/hooks/useT";
import { colors } from "~/lib/theme";

export function LoginScreen() {
  const { login } = useAuth();
  const t = useT();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async () => {
    setLoading(true);
    setError(null);
    try {
      await login();
    } catch (e: any) {
      setError(e.message ?? t("loginFailed"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t("appName")}</Text>
      <Text style={styles.subtitle}>{t("manageGames")}</Text>

      {error && <Text style={styles.error}>{error}</Text>}

      <TouchableOpacity
        style={styles.button}
        onPress={handleLogin}
        disabled={loading}
        accessibilityRole="button"
        accessibilityLabel={t("signIn")}
      >
        {loading ? (
          <ActivityIndicator color={colors.onPrimary} />
        ) : (
          <Text style={styles.buttonText}>{t("signIn")}</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1, backgroundColor: colors.bg,
    justifyContent: "center", alignItems: "center", padding: 24,
  },
  title: { fontSize: 32, fontWeight: "800", color: colors.primary, marginBottom: 8 },
  subtitle: { fontSize: 16, color: colors.textSecondary, marginBottom: 48 },
  error: {
    color: colors.error, fontSize: 14, marginBottom: 16, textAlign: "center",
  },
  button: {
    backgroundColor: colors.primary,
    paddingHorizontal: 32, paddingVertical: 14,
    borderRadius: 12, minWidth: 200, alignItems: "center",
  },
  buttonText: { color: colors.onPrimary, fontSize: 16, fontWeight: "700" },
});
