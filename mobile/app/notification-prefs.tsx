import {
  View, Text, ScrollView, StyleSheet,
  ActivityIndicator, RefreshControl, Switch, Alert,
} from "react-native";
import { useEffect, useState, useCallback } from "react";
import { fetchNotificationPrefs, updateNotificationPrefs } from "~/api/endpoints";
import type { NotificationPrefs } from "~/types/api";
import { useT } from "~/hooks/useT";
import { colors } from "~/lib/theme";

type PrefKey = keyof NotificationPrefs;

const SECTIONS: { title: string; items: { key: PrefKey; label: string; desc?: string }[] }[] = [
  {
    title: "Push notifications",
    items: [
      { key: "pushEnabled", label: "Enable push", desc: "Master toggle for all push notifications" },
      { key: "playerActivityPush", label: "Player activity", desc: "When players join or leave" },
      { key: "gameReminderPush", label: "Game reminders", desc: "Before your game starts" },
      { key: "eventDetailsPush", label: "Event updates", desc: "When event details change" },
      { key: "paymentReminderPush", label: "Payment reminders" },
    ],
  },
  {
    title: "Email notifications",
    items: [
      { key: "emailEnabled", label: "Enable email", desc: "Master toggle for all emails" },
      { key: "gameReminderEmail", label: "Game reminders" },
      { key: "gameInviteEmail", label: "Game invites" },
      { key: "weeklySummaryEmail", label: "Weekly summary" },
      { key: "paymentReminderEmail", label: "Payment reminders" },
    ],
  },
  {
    title: "Reminder timing",
    items: [
      { key: "reminder24h", label: "24 hours before" },
      { key: "reminder2h", label: "2 hours before" },
      { key: "reminder1h", label: "1 hour before" },
    ],
  },
];

export default function NotificationPrefsScreen() {
  const t = useT();
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState<PrefKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetchNotificationPrefs();
      setPrefs(res);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleToggle = async (key: PrefKey, value: boolean) => {
    if (!prefs) return;
    const updated = { ...prefs, [key]: value };
    setPrefs(updated);
    setSaving(key);
    try {
      await updateNotificationPrefs({ [key]: value });
    } catch (e: any) {
      setPrefs(prefs); // revert
      Alert.alert(t("somethingWentWrong"), e.message);
    } finally {
      setSaving(null);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (error || !prefs) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error ?? t("somethingWentWrong")}</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      refreshControl={
        <RefreshControl refreshing={refreshing}
          onRefresh={() => { setRefreshing(true); load(); }}
          tintColor={colors.primary}
        />
      }
    >
      <Text style={styles.heading}>🔔 Notifications</Text>

      {SECTIONS.map((section) => (
        <View key={section.title}>
          <Text style={styles.sectionTitle}>{section.title}</Text>
          {section.items.map((item) => (
            <View key={item.key} style={styles.row}>
              <View style={styles.labelContainer}>
                <Text style={styles.label}>{item.label}</Text>
                {item.desc && <Text style={styles.desc}>{item.desc}</Text>}
              </View>
              <Switch
                value={prefs[item.key] as boolean}
                onValueChange={(v) => handleToggle(item.key, v)}
                disabled={saving === item.key}
                trackColor={{ true: colors.primaryDark }}
                thumbColor={prefs[item.key] ? colors.primary : colors.textMuted}
              />
            </View>
          ))}
        </View>
      ))}

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1, backgroundColor: colors.bg,
    justifyContent: "center", alignItems: "center", padding: 24,
  },
  container: { flex: 1, backgroundColor: colors.bg, padding: 16 },
  heading: {
    color: colors.primary, fontSize: 22, fontWeight: "800",
    marginTop: 8, marginBottom: 16,
  },
  error: { color: colors.error, fontSize: 14 },
  sectionTitle: {
    color: colors.primary, fontSize: 13, fontWeight: "700",
    textTransform: "uppercase", letterSpacing: 1,
    marginTop: 20, marginBottom: 8,
  },
  row: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: colors.surface, borderRadius: 10, padding: 14,
    marginBottom: 8, borderWidth: 1, borderColor: colors.border,
  },
  labelContainer: { flex: 1, marginRight: 12 },
  label: { color: colors.text, fontSize: 15 },
  desc: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
});
