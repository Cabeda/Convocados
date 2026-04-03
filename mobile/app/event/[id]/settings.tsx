import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  TextInput, Alert, Switch, ActivityIndicator,
} from "react-native";
import { useEffect, useState, useCallback } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  fetchEvent, updateTitle, updateLocation,
  updateSport, archiveEvent,
} from "~/api/endpoints";
import { apiFetch } from "~/api/client";
import type { EventDetail } from "~/types/api";
import { useAuth } from "~/hooks/useAuth";
import { useT } from "~/hooks/useT";
import { colors } from "~/lib/theme";
import { SPORT_PRESETS } from "~/lib/sports";
import type { TranslationKey } from "~/lib/i18n";

export default function EventSettingsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const t = useT();

  const [event, setEvent] = useState<EventDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Edit state
  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [maxPlayers, setMaxPlayers] = useState("");
  const [sport, setSport] = useState("football-5v5");
  const [isPublic, setIsPublic] = useState(false);
  const [eloEnabled, setEloEnabled] = useState(false);
  const [splitCosts, setSplitCosts] = useState(true);
  const [password, setPassword] = useState("");
  const [showPasswordField, setShowPasswordField] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const ev = await fetchEvent(id);
      setEvent(ev);
      setTitle(ev.title);
      setLocation(ev.location ?? "");
      setMaxPlayers(String(ev.maxPlayers));
      setSport(ev.sport);
      setIsPublic(ev.isPublic);
      setEloEnabled(ev.eloEnabled);
      setSplitCosts(ev.splitCostsEnabled !== false);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const isOwner = user?.id === event?.ownerId;
  const isAdmin = event?.isAdmin ?? false;
  const canEdit = isOwner || isAdmin || !event?.ownerId;

  const save = async (field: string, fn: () => Promise<unknown>) => {
    setSaving(field);
    try {
      await fn();
      await load();
    } catch (e: any) {
      Alert.alert(t("somethingWentWrong"), e.message);
    } finally {
      setSaving(null);
    }
  };

  const handleSaveTitle = () => save("title", () => updateTitle(id!, title.trim()));
  const handleSaveLocation = () => save("location", () => updateLocation(id!, location.trim()));
  const handleSaveMaxPlayers = () => {
    const n = parseInt(maxPlayers, 10);
    if (isNaN(n) || n < 2 || n > 100) {
      Alert.alert(t("somethingWentWrong"), t("maxPlayersError"));
      return;
    }
    save("maxPlayers", () => apiFetch(`/api/events/${id}/max-players`, {
      method: "PUT",
      body: JSON.stringify({ maxPlayers: n }),
    }).then((r) => r.json()));
  };
  const handleSaveSport = (s: string) => {
    setSport(s);
    save("sport", () => updateSport(id!, s));
  };
  const handleTogglePublic = (v: boolean) => {
    setIsPublic(v);
    save("public", () => apiFetch(`/api/events/${id}/visibility`, {
      method: "PUT",
      body: JSON.stringify({ isPublic: v }),
    }).then((r) => r.json()));
  };
  const handleToggleElo = (v: boolean) => {
    setEloEnabled(v);
    save("elo", () => apiFetch(`/api/events/${id}/elo`, {
      method: "PUT",
      body: JSON.stringify({ eloEnabled: v }),
    }).then((r) => r.json()));
  };
  const handleToggleSplitCosts = (v: boolean) => {
    setSplitCosts(v);
    save("splitCosts", () => apiFetch(`/api/events/${id}/split-costs`, {
      method: "PUT",
      body: JSON.stringify({ splitCostsEnabled: v }),
    }).then((r) => r.json()));
  };
  const handleSetPassword = () => {
    save("password", () => apiFetch(`/api/events/${id}/access`, {
      method: "PUT",
      body: JSON.stringify({ password: password.trim() || null }),
    }).then((r) => r.json()).then(() => {
      setPassword("");
      setShowPasswordField(false);
    }));
  };
  const handleArchive = () => {
    const isArchived = !!event?.archivedAt;
    Alert.alert(
      isArchived ? "Unarchive game?" : "Archive game?",
      isArchived ? "This will restore the game to your active list." : "This will move the game to your archived list.",
      [
        { text: t("cancel"), style: "cancel" },
        {
          text: isArchived ? "Unarchive" : "Archive",
          style: isArchived ? "default" : "destructive",
          onPress: () => save("archive", () => archiveEvent(id!, !isArchived).then(() => router.back())),
        },
      ],
    );
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (error || !event) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error ?? t("eventNotFound")}</Text>
      </View>
    );
  }

  if (!canEdit) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>You don't have permission to edit this event.</Text>
        <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 12 }}>
          <Text style={styles.link}>{t("goBack")}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.heading}>{t("eventSettings")}</Text>

      {/* Title */}
      <Text style={styles.label}>{t("gameTitle")}</Text>
      <View style={styles.row}>
        <TextInput
          style={[styles.input, { flex: 1 }]}
          value={title}
          onChangeText={setTitle}
          maxLength={100}
        />
        <TouchableOpacity
          style={[styles.saveBtn, saving === "title" && { opacity: 0.5 }]}
          onPress={handleSaveTitle}
          disabled={saving === "title"}
        >
          <Text style={styles.saveBtnText}>{saving === "title" ? "…" : t("save")}</Text>
        </TouchableOpacity>
      </View>

      {/* Location */}
      <Text style={styles.label}>{t("locationOptional")}</Text>
      <View style={styles.row}>
        <TextInput
          style={[styles.input, { flex: 1 }]}
          value={location}
          onChangeText={setLocation}
          maxLength={200}
        />
        <TouchableOpacity
          style={[styles.saveBtn, saving === "location" && { opacity: 0.5 }]}
          onPress={handleSaveLocation}
          disabled={saving === "location"}
        >
          <Text style={styles.saveBtnText}>{saving === "location" ? "…" : t("save")}</Text>
        </TouchableOpacity>
      </View>

      {/* Max players */}
      <Text style={styles.label}>{t("maxPlayers")}</Text>
      <View style={styles.row}>
        <TextInput
          style={[styles.input, { width: 80 }]}
          value={maxPlayers}
          onChangeText={setMaxPlayers}
          keyboardType="number-pad"
          maxLength={3}
        />
        <TouchableOpacity
          style={[styles.saveBtn, saving === "maxPlayers" && { opacity: 0.5 }]}
          onPress={handleSaveMaxPlayers}
          disabled={saving === "maxPlayers"}
        >
          <Text style={styles.saveBtnText}>{saving === "maxPlayers" ? "…" : t("save")}</Text>
        </TouchableOpacity>
      </View>

      {/* Sport */}
      <Text style={styles.label}>{t("sport")}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
        {SPORT_PRESETS.map((s) => (
          <TouchableOpacity
            key={s.id}
            style={[styles.chip, sport === s.id && styles.chipActive]}
            onPress={() => handleSaveSport(s.id)}
          >
            <Text style={[styles.chipText, sport === s.id && styles.chipTextActive]}>
              {t(s.labelKey as TranslationKey)}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Toggles */}
      <View style={styles.toggleRow}>
        <Text style={styles.toggleLabel}>Public game</Text>
        <Switch
          value={isPublic}
          onValueChange={handleTogglePublic}
          trackColor={{ true: colors.primaryDark }}
          thumbColor={isPublic ? colors.primary : colors.textMuted}
        />
      </View>
      <View style={styles.toggleRow}>
        <Text style={styles.toggleLabel}>ELO ratings</Text>
        <Switch
          value={eloEnabled}
          onValueChange={handleToggleElo}
          trackColor={{ true: colors.primaryDark }}
          thumbColor={eloEnabled ? colors.primary : colors.textMuted}
        />
      </View>
      <View style={styles.toggleRow}>
        <Text style={styles.toggleLabel}>Split costs</Text>
        <Switch
          value={splitCosts}
          onValueChange={handleToggleSplitCosts}
          trackColor={{ true: colors.primaryDark }}
          thumbColor={splitCosts ? colors.primary : colors.textMuted}
        />
      </View>

      {/* Password */}
      <Text style={styles.sectionTitle}>Access</Text>
      <TouchableOpacity
        style={styles.menuItem}
        onPress={() => setShowPasswordField(!showPasswordField)}
      >
        <Text style={styles.menuText}>
          {event.hasPassword ? "🔒 Password set — tap to change/remove" : "🔓 Set password"}
        </Text>
      </TouchableOpacity>
      {showPasswordField && (
        <View style={styles.row}>
          <TextInput
            style={[styles.input, { flex: 1 }]}
            value={password}
            onChangeText={setPassword}
            placeholder="New password (leave empty to remove)"
            placeholderTextColor={colors.textMuted}
            secureTextEntry
            maxLength={100}
          />
          <TouchableOpacity
            style={[styles.saveBtn, saving === "password" && { opacity: 0.5 }]}
            onPress={handleSetPassword}
            disabled={saving === "password"}
          >
            <Text style={styles.saveBtnText}>{saving === "password" ? "…" : t("save")}</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Danger zone */}
      <Text style={styles.sectionTitle}>Danger zone</Text>
      <TouchableOpacity style={styles.dangerBtn} onPress={handleArchive}>
        <Text style={styles.dangerBtnText}>
          {event.archivedAt ? "Unarchive game" : "Archive game"}
        </Text>
      </TouchableOpacity>

      {/* Navigation */}
      <TouchableOpacity
        style={styles.navBtn}
        onPress={() => router.push(`/event/${id}/rankings`)}
      >
        <Text style={styles.navBtnText}>🏆 Rankings / ELO</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.navBtn}
        onPress={() => router.push(`/event/${id}/payments`)}
      >
        <Text style={styles.navBtnText}>💰 Payments</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.navBtn}
        onPress={() => router.push(`/event/${id}/log`)}
      >
        <Text style={styles.navBtnText}>📋 Event log</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.navBtn}
        onPress={() => router.push(`/event/${id}/attendance`)}
      >
        <Text style={styles.navBtnText}>📅 Attendance stats</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.navBtn}
        onPress={() => router.push(`/event/${id}/calendar`)}
      >
        <Text style={styles.navBtnText}>🗓️ Calendar export</Text>
      </TouchableOpacity>

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
  heading: { color: colors.primary, fontSize: 22, fontWeight: "800", marginBottom: 16, marginTop: 8 },
  error: { color: colors.error, fontSize: 14 },
  link: { color: colors.primary, fontSize: 14, fontWeight: "600" },
  label: { color: colors.textSecondary, fontSize: 13, fontWeight: "600", marginBottom: 6, marginTop: 16 },
  sectionTitle: {
    color: colors.primary, fontSize: 13, fontWeight: "700",
    textTransform: "uppercase", letterSpacing: 1,
    marginTop: 24, marginBottom: 8,
  },
  row: { flexDirection: "row", gap: 8, alignItems: "center" },
  input: {
    backgroundColor: colors.surfaceHover, color: colors.text,
    borderRadius: 10, padding: 12, fontSize: 15,
    borderWidth: 1, borderColor: colors.border,
  },
  saveBtn: {
    backgroundColor: colors.primaryDark, borderRadius: 8,
    paddingHorizontal: 14, paddingVertical: 10,
  },
  saveBtnText: { color: colors.primaryContainer, fontWeight: "600", fontSize: 13 },
  chipRow: { flexDirection: "row", marginBottom: 4 },
  chip: {
    backgroundColor: colors.surface, borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 8, marginRight: 8,
    borderWidth: 1, borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.primaryDark, borderColor: colors.primary },
  chipText: { color: colors.textSecondary, fontSize: 13 },
  chipTextActive: { color: colors.primaryContainer, fontWeight: "600" },
  toggleRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    backgroundColor: colors.surface, borderRadius: 10, padding: 14,
    marginBottom: 8, borderWidth: 1, borderColor: colors.border,
  },
  toggleLabel: { color: colors.text, fontSize: 15 },
  menuItem: {
    backgroundColor: colors.surface, borderRadius: 10, padding: 14,
    marginBottom: 8, borderWidth: 1, borderColor: colors.border,
  },
  menuText: { color: colors.text, fontSize: 14 },
  dangerBtn: {
    backgroundColor: colors.errorBg, borderRadius: 10,
    padding: 14, alignItems: "center", marginBottom: 8,
  },
  dangerBtnText: { color: colors.errorText, fontSize: 14, fontWeight: "700" },
  navBtn: {
    backgroundColor: colors.surface, borderRadius: 10, padding: 14,
    marginBottom: 8, borderWidth: 1, borderColor: colors.border,
  },
  navBtnText: { color: colors.text, fontSize: 14, fontWeight: "600" },
});
