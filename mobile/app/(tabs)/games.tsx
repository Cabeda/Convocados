import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  ActivityIndicator, RefreshControl,
} from "react-native";
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "expo-router";
import { fetchMyGames } from "~/api/endpoints";
import type { EventSummary, MyGamesResponse } from "~/types/api";
import { formatRelativeDate } from "~/utils/date";
import { useT } from "~/hooks/useT";
import { colors } from "~/lib/theme";

export default function GamesTab() {
  const router = useRouter();
  const t = useT();
  const [data, setData] = useState<MyGamesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetchMyGames();
      setData(res);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load();
  }, [load]);

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

  const activeGames = [...(data?.owned ?? []), ...(data?.joined ?? [])];
  const archivedGames = [...(data?.archivedOwned ?? []), ...(data?.archivedJoined ?? [])];
  const games = showArchived ? archivedGames : activeGames;

  if (activeGames.length === 0 && !showArchived) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyTitle}>{t("noGamesYet")}</Text>
        <Text style={styles.emptyDesc}>{t("noGamesDesc")}</Text>
        <TouchableOpacity
          style={styles.createBtn}
          onPress={() => router.push("/create")}
        >
          <Text style={styles.createBtnText}>+ {t("createGame")}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.wrapper}>
      {/* Tab bar: Active / Archived / Public */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tab, !showArchived && styles.tabActive]}
          onPress={() => setShowArchived(false)}
        >
          <Text style={[styles.tabText, !showArchived && styles.tabTextActive]}>
            {t("myGames")} ({activeGames.length})
          </Text>
        </TouchableOpacity>
        {archivedGames.length > 0 && (
          <TouchableOpacity
            style={[styles.tab, showArchived && styles.tabActive]}
            onPress={() => setShowArchived(true)}
          >
            <Text style={[styles.tabText, showArchived && styles.tabTextActive]}>
              {t("archivedGames")} ({archivedGames.length})
            </Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={styles.tab}
          onPress={() => router.push("/public-games")}
        >
          <Text style={styles.tabText}>🌍</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        style={styles.list}
        data={games}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        }
        renderItem={({ item }) => (
          <GameCard
            game={item}
            onPress={() => router.push(`/event/${item.id}`)}
          />
        )}
        ListEmptyComponent={
          <View style={styles.center}>
            <Text style={styles.emptyDesc}>
              {showArchived ? "No archived games." : t("noGamesYet")}
            </Text>
          </View>
        }
      />

      {/* FAB — Create game */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => router.push("/create")}
        accessibilityRole="button"
        accessibilityLabel={t("createGame")}
      >
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>
    </View>
  );
}

function GameCard({
  game,
  onPress,
}: {
  game: EventSummary;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={styles.card}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${game.title}, ${game.playerCount}/${game.maxPlayers} players`}
    >
      <Text style={styles.cardTitle}>{game.title}</Text>
      <Text style={styles.cardMeta}>
        {formatRelativeDate(game.dateTime)} · {game.playerCount}/{game.maxPlayers} players
        {game.isRecurring ? " · 🔁" : ""}
      </Text>
      {game.location ? (
        <Text style={styles.cardLocation} numberOfLines={1}>
          {game.location}
        </Text>
      ) : null}
      {game.archivedAt && (
        <Text style={styles.archivedBadge}>Archived</Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  wrapper: { flex: 1, backgroundColor: colors.bg },
  center: {
    flex: 1, backgroundColor: colors.bg,
    justifyContent: "center", alignItems: "center", padding: 24,
  },
  list: {
    flex: 1, backgroundColor: colors.bg,
    paddingHorizontal: 16, paddingTop: 8,
  },
  error: { color: colors.error, fontSize: 14, textAlign: "center", marginBottom: 12 },
  retryBtn: {
    backgroundColor: colors.surfaceHover,
    paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8,
  },
  retryText: { color: colors.primary, fontWeight: "600" },
  emptyTitle: { color: colors.text, fontSize: 18, fontWeight: "700", marginBottom: 8 },
  emptyDesc: { color: colors.textMuted, fontSize: 14, textAlign: "center", marginBottom: 20 },
  createBtn: {
    backgroundColor: colors.primary, borderRadius: 12,
    paddingHorizontal: 24, paddingVertical: 14,
  },
  createBtnText: { color: colors.onPrimary, fontSize: 16, fontWeight: "700" },

  // Tab bar
  tabBar: {
    flexDirection: "row", paddingHorizontal: 16, paddingTop: 8, gap: 8,
  },
  tab: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  tabActive: { backgroundColor: colors.primaryDark, borderColor: colors.primary },
  tabText: { color: colors.textMuted, fontSize: 13 },
  tabTextActive: { color: colors.primaryContainer, fontWeight: "600" },

  // Game card
  card: {
    backgroundColor: colors.surface, borderRadius: 12,
    padding: 16, marginBottom: 10,
    borderWidth: 1, borderColor: colors.border,
  },
  cardTitle: { color: colors.text, fontSize: 16, fontWeight: "700", marginBottom: 4 },
  cardMeta: { color: colors.textSecondary, fontSize: 13 },
  cardLocation: { color: colors.textMuted, fontSize: 12, marginTop: 4 },
  archivedBadge: {
    color: colors.textMuted, fontSize: 11, fontWeight: "600",
    marginTop: 4, textTransform: "uppercase",
  },

  // FAB
  fab: {
    position: "absolute", bottom: 20, right: 20,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: colors.primary, justifyContent: "center", alignItems: "center",
    elevation: 6,
    shadowColor: "#000", shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3, shadowRadius: 4,
  },
  fabText: { color: colors.onPrimary, fontSize: 28, fontWeight: "600", marginTop: -2 },
});
