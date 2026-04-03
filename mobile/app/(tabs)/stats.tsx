import {
  View, Text, ScrollView, StyleSheet,
  ActivityIndicator, RefreshControl, TouchableOpacity,
} from "react-native";
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "expo-router";
import { fetchMyStats } from "~/api/endpoints";
import type { PlayerStats } from "~/types/api";
import { useT } from "~/hooks/useT";
import { colors } from "~/lib/theme";

export default function StatsTab() {
  const t = useT();
  const router = useRouter();
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetchMyStats();
      setStats(res);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (error || !stats) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error ?? t("somethingWentWrong")}</Text>
      </View>
    );
  }

  const { summary } = stats;

  return (
    <ScrollView
      style={styles.container}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => { setRefreshing(true); load(); }}
          tintColor={colors.primary}
        />
      }
    >
      <Text style={styles.sectionTitle}>{t("overview")}</Text>
      <View style={styles.grid}>
        <StatBox label={t("gamesPlayed")} value={summary.totalGames} />
        <StatBox label={t("wins")} value={summary.totalWins} />
        <StatBox label={t("draws")} value={summary.totalDraws} />
        <StatBox label={t("losses")} value={summary.totalLosses} />
        <StatBox label={t("winRate")} value={`${Math.round(summary.winRate * 100)}%`} />
        <StatBox label={t("avgRating")} value={summary.avgRating} />
      </View>

      {stats.events.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>{t("perEvent")}</Text>
          {stats.events.map((ev) => (
            <TouchableOpacity
              key={ev.eventId}
              style={styles.eventCard}
              onPress={() => router.push(`/event/${ev.eventId}`)}
            >
              <Text style={styles.eventTitle}>{ev.eventTitle}</Text>
              <View style={styles.eventStatsRow}>
                <Text style={styles.eventMeta}>
                  {ev.gamesPlayed} {t("gamesPlayed").toLowerCase()} · {t("rating")}: {ev.rating}
                </Text>
              </View>
              <View style={styles.wdlRow}>
                <Text style={[styles.wdlBadge, { color: colors.success }]}>W{ev.wins}</Text>
                <Text style={[styles.wdlBadge, { color: colors.textMuted }]}>D{ev.draws}</Text>
                <Text style={[styles.wdlBadge, { color: colors.error }]}>L{ev.losses}</Text>
              </View>
              {ev.attendance && (
                <Text style={styles.eventMeta}>
                  {t("attendance")}: {Math.round(ev.attendance.attendanceRate * 100)}% · {t("streak")}: {ev.attendance.currentStreak}
                </Text>
              )}
            </TouchableOpacity>
          ))}
        </>
      )}

      <View style={{ height: 20 }} />
    </ScrollView>
  );
}

function StatBox({ label, value }: { label: string; value: string | number }) {
  return (
    <View style={styles.statBox}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1, backgroundColor: colors.bg,
    justifyContent: "center", alignItems: "center",
  },
  container: { flex: 1, backgroundColor: colors.bg, padding: 16 },
  error: { color: colors.error, fontSize: 14 },
  sectionTitle: {
    color: colors.primary, fontSize: 14, fontWeight: "700",
    textTransform: "uppercase", letterSpacing: 1,
    marginBottom: 12, marginTop: 8,
  },
  grid: {
    flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16,
  },
  statBox: {
    backgroundColor: colors.surface, borderRadius: 10, padding: 12,
    minWidth: "30%", flexGrow: 1, alignItems: "center",
    borderWidth: 1, borderColor: colors.border,
  },
  statValue: { color: colors.text, fontSize: 22, fontWeight: "800" },
  statLabel: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  eventCard: {
    backgroundColor: colors.surface, borderRadius: 10, padding: 14,
    marginBottom: 8, borderWidth: 1, borderColor: colors.border,
  },
  eventTitle: { color: colors.text, fontSize: 15, fontWeight: "700", marginBottom: 4 },
  eventStatsRow: { marginBottom: 4 },
  eventMeta: { color: colors.textSecondary, fontSize: 12 },
  wdlRow: { flexDirection: "row", gap: 8, marginBottom: 4 },
  wdlBadge: { fontSize: 12, fontWeight: "700" },
});
