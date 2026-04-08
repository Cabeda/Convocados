import {
  View, Text, TouchableOpacity, StyleSheet,
  TextInput, Alert, ScrollView,
} from "react-native";
import { useState } from "react";
import { useRouter } from "expo-router";
import { useAuth } from "~/hooks/useAuth";
import { useLocale } from "~/hooks/useT";
import { getServerUrl, setServerUrl } from "~/auth/storage";
import { colors } from "~/lib/theme";
import type { Locale } from "~/lib/i18n";

const LOCALE_OPTIONS: { code: Locale; label: string }[] = [
  { code: "en", label: "English" },
  { code: "pt", label: "Português" },
  { code: "es", label: "Español" },
  { code: "fr", label: "Français" },
  { code: "de", label: "Deutsch" },
  { code: "it", label: "Italiano" },
];

export default function ProfileTab() {
  const { user, logout } = useAuth();
  const { locale, setLocale, t } = useLocale();
  const router = useRouter();
  const [serverUrl, setServerUrlState] = useState("");
  const [editingServer, setEditingServer] = useState(false);
  const [showLanguages, setShowLanguages] = useState(false);

  const loadServerUrl = async () => {
    const url = await getServerUrl();
    setServerUrlState(url);
    setEditingServer(true);
  };

  const saveServerUrl = async () => {
    const trimmed = serverUrl.trim().replace(/\/+$/, "");
    if (!trimmed.startsWith("http")) {
      Alert.alert(t("invalidUrl"), t("urlMustStartWithHttp"));
      return;
    }
    await setServerUrl(trimmed);
    setEditingServer(false);
    Alert.alert(t("saved"), t("serverUrlUpdated"));
  };

  const handleLogout = () => {
    Alert.alert(t("signOut"), t("signOutConfirm"), [
      { text: t("cancel"), style: "cancel" },
      {
        text: t("signOut"),
        style: "destructive",
        onPress: async () => {
          await logout();
          router.replace("/");
        },
      },
    ]);
  };

  return (
    <ScrollView style={styles.container}>
      {user && (
        <View style={styles.profileCard}>
          <Text style={styles.name}>{user.name}</Text>
          <Text style={styles.email}>{user.email}</Text>
        </View>
      )}

      {/* Notification preferences */}
      <TouchableOpacity
        style={styles.menuItem}
        onPress={() => router.push("/notification-prefs")}
      >
        <Text style={styles.menuText}>🔔 Notifications</Text>
        <Text style={styles.menuHint}>Manage push & email preferences</Text>
      </TouchableOpacity>

      {/* Language picker */}
      <TouchableOpacity
        style={styles.menuItem}
        onPress={() => setShowLanguages(!showLanguages)}
      >
        <Text style={styles.menuText}>{t("language")}</Text>
        <Text style={styles.menuHint}>
          {LOCALE_OPTIONS.find((l) => l.code === locale)?.label ?? "English"}
        </Text>
      </TouchableOpacity>

      {showLanguages && (
        <View style={styles.languageList}>
          {LOCALE_OPTIONS.map((opt) => (
            <TouchableOpacity
              key={opt.code}
              style={[styles.languageItem, locale === opt.code && styles.languageItemActive]}
              onPress={() => {
                setLocale(opt.code);
                setShowLanguages(false);
              }}
            >
              <Text style={[
                styles.languageText,
                locale === opt.code && styles.languageTextActive,
              ]}>
                {opt.label}
              </Text>
              {locale === opt.code && <Text style={styles.checkmark}>✓</Text>}
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Server URL */}
      <TouchableOpacity style={styles.menuItem} onPress={loadServerUrl}>
        <Text style={styles.menuText}>{t("serverUrl")}</Text>
        <Text style={styles.menuHint}>{t("configureInstance")}</Text>
      </TouchableOpacity>

      {editingServer && (
        <View style={styles.serverEdit}>
          <TextInput
            style={styles.input}
            value={serverUrl}
            onChangeText={setServerUrlState}
            placeholder="https://convocados.fly.dev"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          <View style={styles.serverBtns}>
            <TouchableOpacity
              style={styles.cancelBtn}
              onPress={() => setEditingServer(false)}
            >
              <Text style={styles.cancelText}>{t("cancel")}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.saveBtn} onPress={saveServerUrl}>
              <Text style={styles.saveText}>{t("save")}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
        <Text style={styles.logoutText}>{t("signOut")}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: 16 },
  profileCard: {
    backgroundColor: colors.surface, borderRadius: 12, padding: 20,
    marginBottom: 16, borderWidth: 1, borderColor: colors.border,
    alignItems: "center",
  },
  name: { color: colors.text, fontSize: 20, fontWeight: "800", marginBottom: 4 },
  email: { color: colors.textMuted, fontSize: 14 },
  menuItem: {
    backgroundColor: colors.surface, borderRadius: 10, padding: 16,
    marginBottom: 8, borderWidth: 1, borderColor: colors.border,
  },
  menuText: { color: colors.text, fontSize: 15, fontWeight: "600" },
  menuHint: { color: colors.textMuted, fontSize: 12, marginTop: 2 },

  // Language picker
  languageList: {
    backgroundColor: colors.surface, borderRadius: 10,
    marginBottom: 8, borderWidth: 1, borderColor: colors.border,
    overflow: "hidden",
  },
  languageItem: {
    paddingHorizontal: 16, paddingVertical: 12,
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  languageItemActive: { backgroundColor: colors.primaryDark },
  languageText: { color: colors.text, fontSize: 14 },
  languageTextActive: { color: colors.primaryContainer, fontWeight: "600" },
  checkmark: { color: colors.primary, fontSize: 16, fontWeight: "700" },

  // Server URL
  serverEdit: {
    backgroundColor: colors.surface, borderRadius: 10, padding: 12,
    marginBottom: 8, borderWidth: 1, borderColor: colors.border,
  },
  input: {
    backgroundColor: colors.surfaceHover, color: colors.text,
    borderRadius: 8, padding: 12, fontSize: 14, marginBottom: 8,
  },
  serverBtns: { flexDirection: "row", justifyContent: "flex-end", gap: 8 },
  cancelBtn: { paddingHorizontal: 16, paddingVertical: 8 },
  cancelText: { color: colors.textMuted, fontWeight: "600" },
  saveBtn: {
    backgroundColor: colors.primaryDark,
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8,
  },
  saveText: { color: colors.primaryContainer, fontWeight: "600" },

  // Logout
  logoutBtn: {
    marginTop: 40, backgroundColor: colors.errorBg, borderRadius: 10,
    padding: 16, alignItems: "center",
  },
  logoutText: { color: colors.errorText, fontSize: 15, fontWeight: "700" },
});
