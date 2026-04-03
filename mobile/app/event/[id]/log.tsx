import {
  View, Text, FlatList, StyleSheet,
  ActivityIndicator, RefreshControl, TouchableOpacity,
} from "react-native";
import { useEffect, useState, useCallback } from "react";
import { useLocalSearchParams } from "expo-router";
import { fetchEventLog } from "~/api/endpoints";
import type { EventLogEntry } from "~/types/api";
import { formatDateTime } from "~/utils/date";
import { useT } from "~/hooks/useT";
import { colors } from "~/lib/theme";

export default function EventLogScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useT();
  const [entries, setEntries] = useState<EventLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const res = await fetchEventLog(id);
      setEntries(res.data);
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
      const res = await fetchEventLog(id, cursor);
      setEntries((prev) => [...prev, ...res.data]);
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
      data={entries}
      keyExtractor={(item) => item.id}
      refreshControl={
        <RefreshControl refreshing={refreshing}
          onRefresh={() => { setRefreshing(true); load(); }}
          tintColor={colors.primary}
        />
      }
      ListHeaderComponent={<Text style={styles.heading}>📋 Event Log</Text>}
      ListEmptyComponent={
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>No log entries yet</Text>
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
        <View style={styles.entry}>
          <View style={styles.entryHeader}>
            <Text style={styles.action}>{item.action}</Text>
            <Text style={styles.time}>{formatDateTime(item.createdAt)}</Text>
          </View>
          {item.actorName && (
            <Text style={styles.actor}>by {item.actorName}</Text>
          )}
          {item.details && (
            <Text style={styles.details}>{item.details}</Text>
          )}
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
  emptyTitle: { color: colors.textMuted, fontSize: 16 },
  entry: {
    backgroundColor: colors.surface, borderRadius: 10, padding: 12,
    marginBottom: 8, borderWidth: 1, borderColor: colors.border,
  },
  entryHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  action: { color: colors.text, fontSize: 14, fontWeight: "600", flex: 1, marginRight: 8 },
  time: { color: colors.textMuted, fontSize: 11 },
  actor: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  details: { color: colors.textMuted, fontSize: 12, marginTop: 4 },
  loadMoreBtn: {
    backgroundColor: colors.surface, borderRadius: 8, padding: 14,
    alignItems: "center", marginVertical: 8,
    borderWidth: 1, borderColor: colors.border,
  },
  loadMoreText: { color: colors.primary, fontSize: 13, fontWeight: "600" },
});
