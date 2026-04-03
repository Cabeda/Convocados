import {
  View, Text, ScrollView, TextInput, TouchableOpacity,
  StyleSheet, Alert, ActivityIndicator, Platform,
} from "react-native";
import { useState } from "react";
import { useRouter } from "expo-router";
import { createEvent } from "~/api/endpoints";
import { useT } from "~/hooks/useT";
import { SPORT_PRESETS, getDefaultMaxPlayers } from "~/lib/sports";
import { colors } from "~/lib/theme";
import type { TranslationKey } from "~/lib/i18n";

function nextHour(): Date {
  const d = new Date();
  d.setHours(d.getHours() + 1, 0, 0, 0);
  return d;
}

function formatLocalDateTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDisplayDate(d: Date): string {
  return d.toLocaleString(undefined, {
    weekday: "short", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export default function CreateEventScreen() {
  const t = useT();
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [dateTime, setDateTime] = useState(nextHour);
  const [sport, setSport] = useState("football-5v5");
  const [maxPlayers, setMaxPlayers] = useState("10");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [teamOneName, setTeamOneName] = useState("Ninjas");
  const [teamTwoName, setTeamTwoName] = useState("Gunas");
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurrenceFreq, setRecurrenceFreq] = useState<"weekly" | "monthly">("weekly");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Simple date adjustment buttons
  const adjustDate = (hours: number) => {
    setDateTime((prev) => {
      const d = new Date(prev);
      d.setHours(d.getHours() + hours);
      return d;
    });
  };

  const adjustDay = (days: number) => {
    setDateTime((prev) => {
      const d = new Date(prev);
      d.setDate(d.getDate() + days);
      return d;
    });
  };

  const handleSportChange = (newSport: string) => {
    setSport(newSport);
    setMaxPlayers(String(getDefaultMaxPlayers(newSport)));
  };

  const handleSubmit = async () => {
    if (!title.trim()) {
      Alert.alert(t("somethingWentWrong"), "Title is required.");
      return;
    }
    const parsed = parseInt(maxPlayers, 10);
    if (isNaN(parsed) || parsed < 2 || parsed > 100) {
      Alert.alert(t("somethingWentWrong"), t("maxPlayersError"));
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const result = await createEvent({
        title: title.trim(),
        location: location.trim() || undefined,
        dateTime: dateTime.toISOString(),
        timezone: tz,
        maxPlayers: parsed,
        sport,
        teamOneName: teamOneName.trim() || "Ninjas",
        teamTwoName: teamTwoName.trim() || "Gunas",
        isRecurring,
        recurrenceFreq: isRecurring ? recurrenceFreq : undefined,
        recurrenceInterval: 1,
      });
      router.replace(`/event/${result.id}`);
    } catch (e: any) {
      setError(e.message ?? t("somethingWentWrong"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScrollView style={styles.container} keyboardShouldPersistTaps="handled">
      <Text style={styles.heading}>{t("createGame")}</Text>

      {error && <Text style={styles.error}>{error}</Text>}

      {/* Title */}
      <Text style={styles.label}>{t("gameTitle")}</Text>
      <TextInput
        style={styles.input}
        value={title}
        onChangeText={setTitle}
        placeholder={t("gameTitlePlaceholder")}
        placeholderTextColor={colors.textMuted}
        maxLength={100}
        autoFocus
      />

      {/* Sport picker */}
      <Text style={styles.label}>{t("sport")}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
        {SPORT_PRESETS.map((s) => (
          <TouchableOpacity
            key={s.id}
            style={[styles.chip, sport === s.id && styles.chipActive]}
            onPress={() => handleSportChange(s.id)}
          >
            <Text style={[styles.chipText, sport === s.id && styles.chipTextActive]}>
              {t(s.labelKey as TranslationKey)}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Location */}
      <Text style={styles.label}>{t("locationOptional")}</Text>
      <TextInput
        style={styles.input}
        value={location}
        onChangeText={setLocation}
        placeholder={t("locationPlaceholder")}
        placeholderTextColor={colors.textMuted}
        maxLength={200}
      />

      {/* Date & Time */}
      <Text style={styles.label}>{t("dateTime")}</Text>
      <View style={styles.dateContainer}>
        <Text style={styles.dateDisplay}>{formatDisplayDate(dateTime)}</Text>
        <View style={styles.dateButtons}>
          <TouchableOpacity style={styles.dateBtn} onPress={() => adjustDay(-1)}>
            <Text style={styles.dateBtnText}>-1d</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.dateBtn} onPress={() => adjustDate(-1)}>
            <Text style={styles.dateBtnText}>-1h</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.dateBtn} onPress={() => adjustDate(1)}>
            <Text style={styles.dateBtnText}>+1h</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.dateBtn} onPress={() => adjustDay(1)}>
            <Text style={styles.dateBtnText}>+1d</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Max players */}
      <Text style={styles.label}>{t("maxPlayers")}</Text>
      <TextInput
        style={[styles.input, { width: 80 }]}
        value={maxPlayers}
        onChangeText={setMaxPlayers}
        keyboardType="number-pad"
        maxLength={3}
      />
      <Text style={styles.helper}>{t("maxPlayersHelper")}</Text>

      {/* Advanced options toggle */}
      <TouchableOpacity
        style={styles.advancedToggle}
        onPress={() => setShowAdvanced(!showAdvanced)}
      >
        <Text style={styles.advancedToggleText}>
          {showAdvanced ? "▼" : "▶"} {t("advancedOptions")}
        </Text>
      </TouchableOpacity>

      {showAdvanced && (
        <View style={styles.advancedSection}>
          <Text style={styles.label}>{t("team1Name")}</Text>
          <TextInput
            style={styles.input}
            value={teamOneName}
            onChangeText={setTeamOneName}
            placeholder="Ninjas"
            placeholderTextColor={colors.textMuted}
            maxLength={50}
          />
          <Text style={styles.label}>{t("team2Name")}</Text>
          <TextInput
            style={styles.input}
            value={teamTwoName}
            onChangeText={setTeamTwoName}
            placeholder="Gunas"
            placeholderTextColor={colors.textMuted}
            maxLength={50}
          />

          {/* Recurrence */}
          <View style={styles.toggleRow}>
            <Text style={styles.label}>Recurring game</Text>
            <TouchableOpacity
              style={[styles.chip, isRecurring && styles.chipActive]}
              onPress={() => setIsRecurring(!isRecurring)}
            >
              <Text style={[styles.chipText, isRecurring && styles.chipTextActive]}>
                {isRecurring ? "On" : "Off"}
              </Text>
            </TouchableOpacity>
          </View>
          {isRecurring && (
            <View style={styles.freqRow}>
              {(["weekly", "monthly"] as const).map((f) => (
                <TouchableOpacity
                  key={f}
                  style={[styles.chip, recurrenceFreq === f && styles.chipActive]}
                  onPress={() => setRecurrenceFreq(f)}
                >
                  <Text style={[styles.chipText, recurrenceFreq === f && styles.chipTextActive]}>
                    {f.charAt(0).toUpperCase() + f.slice(1)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      )}

      {/* Submit */}
      <TouchableOpacity
        style={[styles.submitBtn, submitting && { opacity: 0.5 }]}
        onPress={handleSubmit}
        disabled={submitting}
      >
        {submitting ? (
          <ActivityIndicator color={colors.onPrimary} />
        ) : (
          <Text style={styles.submitText}>{t("createGameBtn")}</Text>
        )}
      </TouchableOpacity>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: 16 },
  heading: {
    color: colors.primary, fontSize: 24, fontWeight: "800",
    marginBottom: 20, marginTop: 8,
  },
  error: { color: colors.error, fontSize: 14, marginBottom: 12 },
  label: {
    color: colors.textSecondary, fontSize: 13, fontWeight: "600",
    marginBottom: 6, marginTop: 16,
  },
  input: {
    backgroundColor: colors.surfaceHover, color: colors.text,
    borderRadius: 10, padding: 14, fontSize: 15,
    borderWidth: 1, borderColor: colors.border,
  },
  helper: { color: colors.textMuted, fontSize: 12, marginTop: 4 },
  chipRow: { flexDirection: "row", marginBottom: 4 },
  chip: {
    backgroundColor: colors.surface, borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 8, marginRight: 8,
    borderWidth: 1, borderColor: colors.border,
  },
  chipActive: {
    backgroundColor: colors.primaryDark, borderColor: colors.primary,
  },
  chipText: { color: colors.textSecondary, fontSize: 13 },
  chipTextActive: { color: colors.primaryContainer, fontWeight: "600" },
  dateContainer: {
    backgroundColor: colors.surface, borderRadius: 10, padding: 14,
    borderWidth: 1, borderColor: colors.border,
  },
  dateDisplay: {
    color: colors.text, fontSize: 16, fontWeight: "600",
    textAlign: "center", marginBottom: 10,
  },
  dateButtons: { flexDirection: "row", justifyContent: "center", gap: 8 },
  dateBtn: {
    backgroundColor: colors.surfaceHover, borderRadius: 8,
    paddingHorizontal: 14, paddingVertical: 8,
  },
  dateBtnText: { color: colors.primary, fontSize: 13, fontWeight: "600" },
  advancedToggle: { marginTop: 20, paddingVertical: 8 },
  advancedToggleText: { color: colors.textMuted, fontSize: 14 },
  advancedSection: { marginTop: 4 },
  submitBtn: {
    backgroundColor: colors.primary, borderRadius: 12,
    padding: 16, alignItems: "center", marginTop: 24,
  },
  submitText: {
    color: colors.onPrimary, fontSize: 16, fontWeight: "700",
  },
  toggleRow: {
    flexDirection: "row", justifyContent: "space-between",
    alignItems: "center", marginTop: 16,
  },
  freqRow: { flexDirection: "row", gap: 8, marginTop: 8 },
});
