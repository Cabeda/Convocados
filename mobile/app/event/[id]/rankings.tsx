import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  ActivityIndicator, RefreshControl,
} from "react-native";
import { useEffect, useState, useCallback } from "react";
import { useLocalSearchParams } from "expo-router";
import { fetchRatings } from "~/api/endpoints";
import type { PlayerRating } from "~/types/api";
import { useT } from "~/hooks/useT";
import { colors } from "~/lib/theme";

export default function RankingsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useT();
  const [ratings, setRatings] = useState<PlayerRating[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const res = await fetchRatings(id);
      setRatings(res.data);
      setHasMore(res.hasMore);
      setCursor(res.nextCursor);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const loadMore = async () => {
    if (!id || !hasMore || !cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await fetchRatings(id, cursor);
      setRatings((prev) => [...prev, ...res.data]);
      setHasMore(res.hasMore);
      setCursor(res.nextCursor);
    } catch { /* ignore */ } finally {
      setLoadingMore(false);
    }
  };

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
      data={ratings}
      keyExtractor={(item) => item.id}
      refreshControl={
        <RefreshControl refreshing={refreshing}
          onRefresh={() => { setRefreshing(true); load(); }}
          tintColor={colors.primary}
        />
      }
      ListHeaderComponent={
        <Text style={styles.heading}>🏆 Rankings</Text>
      }
      ListEmptyComponent={
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>No ratings yet</Text>
          <Text style={styles.emptyDesc}>Play some games and record scores to build rankings.</Text>
        </View>
      }
      ListFooterComponent={
        hasMore ? (
          <TouchableOpacity style={styles.loadMoreBtn} onPress={loadMore} disabled={loadingMore}>
            <Text style={styles.loadMoreText}>{loadingMore ? "Loading…" : t("loadMore")}</Text>
          </TouchableOpacity>
        ) : null
      }
      renderItem={({ item, index }) => (
        <View style={styles.row}>
          <Text style={styles.rank}>#{index + 1}</Text>
          <View style={styles.playerInfo}>
            <Text style={styles.playerName}>{item.name}</Text>
            <Text style={styles.playerMeta}>
              {item.gamesPlayed}g · W{item.wins}/D{item.draws}/L{item.losses}
            </Text>
          </View>
          <View style={styles.ratingBadge}>
            <Text style={[
              styles.ratingValue,
              { color: item.rating >= 1200 ? colors.success : item.rating >= 1000 ? colors.primary : colors.warning },
            ]}>
              {item.rating}
            </Text>
          </View>
        </View>
      )}
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
    marginTop: 16, marginBottom: 12,
  },
  error: { color: colors.error, fontSize: 14 },
  emptyTitle: { color: colors.text, fontSize: 18, fontWeight: "700", marginBottom: 8 },
  emptyDesc: { color: colors.textMuted, fontSize: 14, textAlign: "center" },
  row: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: colors.surface, borderRadius: 10, padding: 14,
    marginBottom: 8, borderWidth: 1, borderColor: colors.border,
    gap: 12,
  },
  rank: { color: colors.textMuted, fontSize: 14, fontWeight: "700", width: 28 },
  playerInfo: { flex: 1 },
  playerName: { color: colors.text, fontSize: 15, fontWeight: "700" },
  playerMeta: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  ratingBadge: {
    backgroundColor: colors.surfaceHover, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 6,
  },
  ratingValue: { fontSize: 16, fontWeight: "800" },
  loadMoreBtn: {
    backgroundColor: colors.surface, borderRadius: 8, padding: 14,
    alignItems: "center", marginVertical: 8,
    borderWidth: 1, borderColor: colors.border,
  },
  loadMoreText: { color: colors.primary, fontSize: 13, fontWeight: "600" },
});
