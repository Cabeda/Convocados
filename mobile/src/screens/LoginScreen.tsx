import {
  View, Text, TouchableOpacity, StyleSheet,
  ActivityIndicator, TextInput, Alert,
} from "react-native";
import { useState, useEffect } from "react";
import { useAuth } from "~/hooks/useAuth";
import { useT } from "~/hooks/useT";
import { colors } from "~/lib/theme";
import { getServerUrl, setServerUrl } from "~/auth/storage";

export function LoginScreen() {
  const { login } = useAuth();
  const t = useT();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showServerConfig, setShowServerConfig] = useState(false);
  const [serverInput, setServerInput] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getServerUrl().then(setServerInput);
  }, []);

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

  const handleSaveServer = async () => {
    const url = serverInput.trim();
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      Alert.alert(t("invalidUrl"), t("urlMustStartWithHttp"));
      return;
    }
    setSaving(true);
    try {
      await setServerUrl(url.replace(/\/$/, ""));
      setShowServerConfig(false);
      Alert.alert(t("saved"), t("serverUrlUpdated"));
    } finally {
      setSaving(false);
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

      <TouchableOpacity
        style={styles.configLink}
        onPress={() => setShowServerConfig((v) => !v)}
      >
        <Text style={styles.configLinkText}>{t("configureInstance")}</Text>
      </TouchableOpacity>

      {showServerConfig && (
        <View style={styles.serverBox}>
          <Text style={styles.serverLabel}>{t("serverUrl")}</Text>
          <TextInput
            style={styles.serverInput}
            value={serverInput}
            onChangeText={setServerInput}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder="https://convocados.fly.dev"
            placeholderTextColor={colors.textMuted}
          />
          <TouchableOpacity
            style={styles.saveButton}
            onPress={handleSaveServer}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator color={colors.onPrimary} />
            ) : (
              <Text style={styles.saveButtonText}>{t("save")}</Text>
            )}
          </TouchableOpacity>
        </View>
      )}
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
  error: { color: colors.error, fontSize: 14, marginBottom: 16, textAlign: "center" },
  button: {
    backgroundColor: colors.primary,
    paddingHorizontal: 32, paddingVertical: 14,
    borderRadius: 12, minWidth: 200, alignItems: "center",
  },
  buttonText: { color: colors.onPrimary, fontSize: 16, fontWeight: "700" },
  configLink: { marginTop: 24 },
  configLinkText: { color: colors.textMuted, textDecorationLine: "underline" },
  serverBox: {
    marginTop: 16, width: "100%",
    backgroundColor: colors.surface, borderRadius: 12,
    padding: 16, borderWidth: 1, borderColor: colors.border,
  },
  serverLabel: { color: colors.textSecondary, fontSize: 13, marginBottom: 8 },
  serverInput: {
    backgroundColor: colors.bg, borderRadius: 8,
    borderWidth: 1, borderColor: colors.border,
    color: colors.text, fontSize: 14,
    paddingHorizontal: 12, paddingVertical: 10,
    marginBottom: 12,
  },
  saveButton: {
    backgroundColor: colors.primary, borderRadius: 8,
    paddingVertical: 10, alignItems: "center",
  },
  saveButtonText: { color: colors.onPrimary, fontSize: 14, fontWeight: "700" },
});
