import {
  View, Text, FlatList, StyleSheet,
  ActivityIndicator, RefreshControl,
} from "react-native";
import { useEffect, useState, useCallback } from "react";
import { useLocalSearchParams } from "expo-router";
import { fetchAttendance } from "~/api/endpoints";
import type { AttendanceRecord } from "~/types/api";
import { useT } from "~/hooks/useT";
import { colors } from "~/lib/theme";

export default function AttendanceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useT();
  const [players, setPlayers] = useState<AttendanceRecord[]>([]);
  const [totalGames, setTotalGames] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const res = await fetchAttendance(id);
      setPlayers(res.players);
      setTotalGames(res.totalGames);
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

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error}</Text>
      </View>
    );
  }

  return (
    <FlatList
      style={styles.list}
      data={players}
      keyExtractor={(item) => item.name}
      refreshControl={
        <RefreshControl refreshing={refreshing}
          onRefresh={() => { setRefreshing(true); load(); }}
          tintColor={colors.primary}
        />
      }
      ListHeaderComponent={
        <View>
          <Text style={styles.heading}>📅 {t("attendance")}</Text>
          <Text style={styles.subtitle}>{totalGames} games played</Text>
        </View>
      }
      ListEmptyComponent={
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>No attendance data yet</Text>
          <Text style={styles.emptyDesc}>Play some games with recorded teams to see attendance stats.</Text>
        </View>
      }
      renderItem={({ item, index }) => {
        const pct = Math.round(item.attendanceRate * 100);
        return (
          <View style={styles.row}>
            <Text style={styles.rank}>#{index + 1}</Text>
            <View style={styles.playerInfo}>
              <Text style={styles.playerName}>{item.name}</Text>
              <View style={styles.barContainer}>
                <View style={[styles.bar, { width: `${pct}%` as any }]} />
              </View>
              <Text style={styles.playerMeta}>
                {item.gamesPlayed}/{item.totalGames} games · streak: {item.currentStreak}
              </Text>
            </View>
            <Text style={[
              styles.pct,
              { color: pct >= 80 ? colors.success : pct >= 50 ? colors.primary : colors.warning },
            ]}>
              {pct}%
            </Text>
          </View>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1, backgroundColor: colors.bg,
    justifyContent: "center", alignItems: "center", padding: 24,
  },
  list: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: 16 },
  heading: {
    color: colors.primary, fontSize: 22, fontWeight: "800",
    marginTop: 16, marginBottom: 4,
  },
  subtitle: { color: colors.textMuted, fontSize: 13, marginBottom: 12 },
  error: { color: colors.error, fontSize: 14 },
  emptyTitle: { color: colors.text, fontSize: 18, fontWeight: "700", marginBottom: 8 },
  emptyDesc: { color: colors.textMuted, fontSize: 14, textAlign: "center" },
  row: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: colors.surface, borderRadius: 10, padding: 14,
    marginBottom: 8, borderWidth: 1, borderColor: colors.border,
    gap: 10,
  },
  rank: { color: colors.textMuted, fontSize: 13, fontWeight: "700", width: 28 },
  playerInfo: { flex: 1 },
  playerName: { color: colors.text, fontSize: 15, fontWeight: "700", marginBottom: 4 },
  barContainer: {
    height: 4, backgroundColor: colors.surfaceHover,
    borderRadius: 2, marginBottom: 4, overflow: "hidden",
  },
  bar: { height: "100%", backgroundColor: colors.primaryDark, borderRadius: 2 },
  playerMeta: { color: colors.textMuted, fontSize: 11 },
  pct: { fontSize: 16, fontWeight: "800", minWidth: 40, textAlign: "right" },
});
