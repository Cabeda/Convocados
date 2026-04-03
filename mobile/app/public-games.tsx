import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  ActivityIndicator, RefreshControl,
} from "react-native";
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "expo-router";
import { fetchPublicEvents, addPlayer } from "~/api/endpoints";
import type { PublicEvent } from "~/types/api";
import { formatRelativeDate } from "~/utils/date";
import { useAuth } from "~/hooks/useAuth";
import { useT } from "~/hooks/useT";
import { colors } from "~/lib/theme";

export default function PublicGamesScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const t = useT();
  const [events, setEvents] = useState<PublicEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetchPublicEvents();
      setEvents(res.data);
      setHasMore(res.hasMore);
      setCursor(res.nextCursor);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const loadMore = async () => {
    if (!hasMore || !cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await fetchPublicEvents(cursor);
      setEvents((prev) => [...prev, ...res.data]);
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
        <TouchableOpacity onPress={load} style={styles.retryBtn}>
          <Text style={styles.retryText}>{t("retry")}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <FlatList
      style={styles.list}
      data={events}
      keyExtractor={(item) => item.id}
      refreshControl={
        <RefreshControl refreshing={refreshing}
          onRefresh={() => { setRefreshing(true); load(); }}
          tintColor={colors.primary}
        />
      }
      ListHeaderComponent={
        <Text style={styles.heading}>🌍 Public Games</Text>
      }
      ListEmptyComponent={
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>No public games right now</Text>
          <Text style={styles.emptyDesc}>Create a game and make it public so others can find it.</Text>
        </View>
      }
      ListFooterComponent={
        hasMore ? (
          <TouchableOpacity style={styles.loadMoreBtn} onPress={loadMore} disabled={loadingMore}>
            <Text style={styles.loadMoreText}>{loadingMore ? "Loading…" : t("loadMore")}</Text>
          </TouchableOpacity>
        ) : null
      }
      renderItem={({ item }) => (
        <TouchableOpacity
          style={styles.card}
          onPress={() => router.push(`/event/${item.id}`)}
        >
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>{item.title}</Text>
            <View style={[
              styles.spotsBadge,
              item.spotsLeft === 0 && { backgroundColor: colors.errorBg },
            ]}>
              <Text style={styles.spotsBadgeText}>
                {item.spotsLeft === 0 ? "Full" : `${item.spotsLeft} spots`}
              </Text>
            </View>
          </View>
          <Text style={styles.cardMeta}>
            {formatRelativeDate(item.dateTime)} · {item.playerCount}/{item.maxPlayers} players
          </Text>
          {item.location ? (
            <Text style={styles.cardLocation} numberOfLines={1}>📍 {item.location}</Text>
          ) : null}
        </TouchableOpacity>
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
  error: { color: colors.error, fontSize: 14, textAlign: "center", marginBottom: 12 },
  retryBtn: {
    backgroundColor: colors.surfaceHover,
    paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8,
  },
  retryText: { color: colors.primary, fontWeight: "600" },
  emptyTitle: { color: colors.text, fontSize: 18, fontWeight: "700", marginBottom: 8 },
  emptyDesc: { color: colors.textMuted, fontSize: 14, textAlign: "center" },
  card: {
    backgroundColor: colors.surface, borderRadius: 12,
    padding: 16, marginBottom: 10,
    borderWidth: 1, borderColor: colors.border,
  },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 },
  cardTitle: { color: colors.text, fontSize: 16, fontWeight: "700", flex: 1, marginRight: 8 },
  spotsBadge: {
    backgroundColor: colors.primaryDark, borderRadius: 12,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  spotsBadgeText: { color: colors.primaryContainer, fontSize: 12, fontWeight: "600" },
  cardMeta: { color: colors.textSecondary, fontSize: 13 },
  cardLocation: { color: colors.textMuted, fontSize: 12, marginTop: 4 },
  loadMoreBtn: {
    backgroundColor: colors.surface, borderRadius: 8, padding: 14,
    alignItems: "center", marginVertical: 8,
    borderWidth: 1, borderColor: colors.border,
  },
  loadMoreText: { color: colors.primary, fontSize: 13, fontWeight: "600" },
});
