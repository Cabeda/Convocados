import {
  View, Text, ScrollView, StyleSheet,
  ActivityIndicator, RefreshControl,
} from "react-native";
import { useEffect, useState, useCallback } from "react";
import { useLocalSearchParams } from "expo-router";
import { fetchUserProfile, fetchUserStats } from "~/api/endpoints";
import type { UserPublicProfile, PlayerStats } from "~/types/api";
import { useT } from "~/hooks/useT";
import { colors } from "~/lib/theme";

export default function UserProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useT();
  const [profile, setProfile] = useState<UserPublicProfile | null>(null);
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [p, s] = await Promise.all([
        fetchUserProfile(id),
        fetchUserStats(id).catch(() => null),
      ]);
      setProfile(p);
      setStats(s);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (error || !profile) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error ?? "User not found"}</Text>
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
      {/* Profile card */}
      <View style={styles.profileCard}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{profile.name.charAt(0).toUpperCase()}</Text>
        </View>
        <Text style={styles.name}>{profile.name}</Text>
      </View>

      {/* Stats */}
      {stats && (
        <>
          <Text style={styles.sectionTitle}>{t("overview")}</Text>
          <View style={styles.grid}>
            <StatBox label={t("gamesPlayed")} value={stats.summary.totalGames} />
            <StatBox label={t("wins")} value={stats.summary.totalWins} />
            <StatBox label={t("draws")} value={stats.summary.totalDraws} />
            <StatBox label={t("losses")} value={stats.summary.totalLosses} />
            <StatBox label={t("winRate")} value={`${Math.round(stats.summary.winRate * 100)}%`} />
            <StatBox label={t("avgRating")} value={stats.summary.avgRating} />
          </View>

          {stats.events.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>{t("perEvent")}</Text>
              {stats.events.map((ev) => (
                <View key={ev.eventId} style={styles.eventCard}>
                  <Text style={styles.eventTitle}>{ev.eventTitle}</Text>
                  <Text style={styles.eventMeta}>
                    {ev.gamesPlayed}g · {t("rating")}: {ev.rating} · W{ev.wins}/D{ev.draws}/L{ev.losses}
                  </Text>
                </View>
              ))}
            </>
          )}
        </>
      )}

      <View style={{ height: 40 }} />
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
    justifyContent: "center", alignItems: "center", padding: 24,
  },
  container: { flex: 1, backgroundColor: colors.bg, padding: 16 },
  error: { color: colors.error, fontSize: 14 },
  profileCard: {
    backgroundColor: colors.surface, borderRadius: 16, padding: 24,
    alignItems: "center", marginBottom: 16,
    borderWidth: 1, borderColor: colors.border,
  },
  avatar: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: colors.primaryDark, justifyContent: "center", alignItems: "center",
    marginBottom: 12,
  },
  avatarText: { color: colors.primary, fontSize: 32, fontWeight: "800" },
  name: { color: colors.text, fontSize: 22, fontWeight: "800" },
  sectionTitle: {
    color: colors.primary, fontSize: 13, fontWeight: "700",
    textTransform: "uppercase", letterSpacing: 1,
    marginBottom: 12, marginTop: 8,
  },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 },
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
  eventMeta: { color: colors.textSecondary, fontSize: 12 },
});
