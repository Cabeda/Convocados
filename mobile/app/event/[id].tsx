import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, RefreshControl, TextInput, Alert, Share,
} from "react-native";
import { useEffect, useState, useCallback, useRef } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  fetchEvent, addPlayer, removePlayer, fetchHistory,
  randomizeTeams, undoRemovePlayer, claimPlayer, fetchKnownPlayers,
  updateScore, verifyEventPassword, fetchPostGameStatus,
} from "~/api/endpoints";
import type { EventDetail, GameHistory, KnownPlayer, PostGameStatus } from "~/types/api";
import { formatDateTime, formatTime } from "~/utils/date";
import { useAuth } from "~/hooks/useAuth";
import { useT } from "~/hooks/useT";
import { colors } from "~/lib/theme";
import { getServerUrl } from "~/auth/storage";

export default function EventScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const t = useT();
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [locked, setLocked] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [verifyingPassword, setVerifyingPassword] = useState(false);
  const [history, setHistory] = useState<GameHistory[]>([]);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [loadingMoreHistory, setLoadingMoreHistory] = useState(false);
  const [knownPlayers, setKnownPlayers] = useState<KnownPlayer[]>([]);
  const [postGame, setPostGame] = useState<PostGameStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newPlayer, setNewPlayer] = useState("");
  const [adding, setAdding] = useState(false);
  const [undoData, setUndoData] = useState<{
    name: string; order: number; userId: string | null; removedAt: number;
  } | null>(null);
  const [editingScore, setEditingScore] = useState<string | null>(null);
  const [scoreOne, setScoreOne] = useState("");
  const [scoreTwo, setScoreTwo] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [ev, hist, kp] = await Promise.all([
        fetchEvent(id),
        fetchHistory(id).catch(() => ({ data: [], nextCursor: null, hasMore: false })),
        fetchKnownPlayers(id).catch(() => ({ players: [] })),
      ]);
      if (ev.locked) {
        setLocked(true);
        setLoading(false);
        setRefreshing(false);
        return;
      }
      setEvent(ev);
      setLocked(false);
      setHistory(hist.data);
      setHistoryHasMore(hist.hasMore);
      setHistoryCursor(hist.nextCursor);
      setKnownPlayers(kp.players);
      setError(null);
      // Fetch post-game status in background
      fetchPostGameStatus(id).then(setPostGame).catch(() => {});
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id]);

  const loadMoreHistory = useCallback(async () => {
    if (!id || !historyHasMore || !historyCursor || loadingMoreHistory) return;
    setLoadingMoreHistory(true);
    try {
      const hist = await fetchHistory(id, historyCursor);
      setHistory((prev) => [...prev, ...hist.data]);
      setHistoryHasMore(hist.hasMore);
      setHistoryCursor(hist.nextCursor);
    } catch { /* ignore */ } finally {
      setLoadingMoreHistory(false);
    }
  }, [id, historyHasMore, historyCursor, loadingMoreHistory]);

  const handleVerifyPassword = async () => {
    if (!id || !password.trim()) return;
    setVerifyingPassword(true);
    setPasswordError(null);
    try {
      await verifyEventPassword(id, password.trim());
      setLocked(false);
      setPassword("");
      await load();
    } catch (e: any) {
      setPasswordError(e.message ?? "Incorrect password");
    } finally {
      setVerifyingPassword(false);
    }
  };

  useEffect(() => { load(); }, [load]);

  // Poll every 15s
  useEffect(() => {
    pollRef.current = setInterval(load, 15_000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [load]);

  // Undo timer — 60s window
  useEffect(() => {
    if (!undoData) return;
    const timer = setTimeout(() => setUndoData(null), 60_000);
    return () => clearTimeout(timer);
  }, [undoData]);

  const handleAddPlayer = async () => {
    if (!id || !newPlayer.trim()) return;
    setAdding(true);
    try {
      await addPlayer(id, newPlayer.trim());
      setNewPlayer("");
      await load();
    } catch (e: any) {
      Alert.alert(t("somethingWentWrong"), e.message);
    } finally {
      setAdding(false);
    }
  };

  const handleQuickJoin = async () => {
    if (!id || !user?.name) return;
    setAdding(true);
    try {
      await addPlayer(id, user.name, true);
      await load();
    } catch (e: any) {
      Alert.alert(t("somethingWentWrong"), e.message);
    } finally {
      setAdding(false);
    }
  };

  const handleQuickLeave = async () => {
    if (!id || !event || !user) return;
    const myPlayer = event.players.find(
      (p) => p.name.toLowerCase() === user.name.toLowerCase()
    );
    if (!myPlayer) return;
    handleRemovePlayer(myPlayer.id, myPlayer.name);
  };

  const handleRemovePlayer = (playerId: string, playerName: string) => {
    if (!id) return;
    Alert.alert(t("remove"), t("removePlayer", { name: playerName }), [
      { text: t("cancel"), style: "cancel" },
      {
        text: t("remove"),
        style: "destructive",
        onPress: async () => {
          try {
            const result = await removePlayer(id, playerId);
            if (result.undo) {
              setUndoData({ ...result.undo, name: result.undo.name ?? playerName, order: result.undo.order ?? 0, userId: result.undo.userId ?? null, removedAt: result.undo.removedAt ?? Date.now() } as any);
            }
            await load();
          } catch (e: any) {
            Alert.alert(t("somethingWentWrong"), e.message);
          }
        },
      },
    ]);
  };

  const handleUndo = async () => {
    if (!id || !undoData) return;
    try {
      await undoRemovePlayer(id, undoData);
      setUndoData(null);
      await load();
    } catch (e: any) {
      Alert.alert(t("somethingWentWrong"), e.message);
    }
  };

  const handleRandomize = async () => {
    if (!id) return;
    if (event?.teamResults && event.teamResults.length > 0) {
      Alert.alert(t("rerandomizeTitle"), t("rerandomizeDesc"), [
        { text: t("cancel"), style: "cancel" },
        { text: t("randomize"), onPress: () => doRandomize() },
      ]);
    } else {
      doRandomize();
    }
  };

  const doRandomize = async () => {
    if (!id) return;
    try {
      await randomizeTeams(id, event?.balanced ?? false);
      await load();
    } catch (e: any) {
      Alert.alert(t("somethingWentWrong"), e.message);
    }
  };

  const handleShare = async () => {
    if (!event) return;
    try {
      const serverUrl = await getServerUrl();
      const url = `${serverUrl}/events/${id}`;
      const spotsLeft = event.maxPlayers - event.players.length;
      const dateStr = formatDateTime(event.dateTime);
      const text = [
        `⚽ ${event.title}`,
        `📅 ${dateStr}`,
        event.location && `📍 ${event.location}`,
        spotsLeft > 0 ? `👥 ${t("spotsLeft", { n: spotsLeft })}` : `👥 ${t("full")}`,
      ].filter(Boolean).join("\n");

      await Share.share({ message: `${text}\n\n${url}`, url });
    } catch { /* user cancelled */ }
  };

  const handleSaveScore = async (historyId: string) => {
    if (!id) return;
    const s1 = parseInt(scoreOne, 10);
    const s2 = parseInt(scoreTwo, 10);
    if (isNaN(s1) || isNaN(s2)) return;
    try {
      await updateScore(id, historyId, s1, s2);
      setEditingScore(null);
      await load();
    } catch (e: any) {
      Alert.alert(t("somethingWentWrong"), e.message);
    }
  };

  const handleClaimPlayer = (playerId: string, playerName: string) => {
    if (!id) return;
    Alert.alert("Claim player", `Link "${playerName}" to your account?`, [
      { text: t("cancel"), style: "cancel" },
      {
        text: t("confirm"),
        onPress: async () => {
          try {
            await claimPlayer(id, playerId);
            await load();
          } catch (e: any) {
            Alert.alert(t("somethingWentWrong"), e.message);
          }
        },
      },
    ]);
  };

  // ── Loading / Error states ──────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  // Password-locked event
  if (locked) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>🔒 This game is password-protected</Text>
        <Text style={styles.meta}>Enter the password to view it.</Text>
        {passwordError && <Text style={styles.errorText}>{passwordError}</Text>}
        <TextInput
          style={[styles.input, { marginTop: 16, width: "100%" }]}
          value={password}
          onChangeText={setPassword}
          placeholder="Password"
          placeholderTextColor={colors.textMuted}
          secureTextEntry
          onSubmitEditing={handleVerifyPassword}
          returnKeyType="done"
        />
        <TouchableOpacity
          style={[styles.joinBtn, { marginTop: 12, width: "100%" }, verifyingPassword && { opacity: 0.5 }]}
          onPress={handleVerifyPassword}
          disabled={verifyingPassword}
        >
          <Text style={styles.joinBtnText}>{verifyingPassword ? "Checking…" : "Unlock"}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 16 }}>
          <Text style={styles.backText}>{t("goBack")}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (error || !event) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{error ?? t("eventNotFound")}</Text>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>{t("goBack")}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Derived state ───────────────────────────────────────────────────────────

  const activePlayers = event.players.slice(0, event.maxPlayers);
  const benchPlayers = event.players.slice(event.maxPlayers);
  const isOwner = user?.id === event.ownerId;
  const isAuthenticated = !!user;
  const myPlayer = user ? event.players.find(
    (p) => p.name.toLowerCase() === user.name.toLowerCase()
  ) : null;
  const isOnBench = myPlayer ? event.players.indexOf(myPlayer) >= event.maxPlayers : false;
  const canClaimPlayer = isAuthenticated && !event.players.some((p) => p.userId === user?.id);
  const canRemove = (p: { userId: string | null }) =>
    isOwner || (user && p.userId === user.id) || !p.userId;

  // Filter known player suggestions
  const currentNames = new Set(event.players.map((p) => p.name.toLowerCase()));
  const suggestions = knownPlayers
    .filter((kp) => !currentNames.has(kp.name.toLowerCase()))
    .slice(0, 5);

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
      {/* Header */}
      <Text style={styles.title}>{event.title}</Text>
      <Text style={styles.meta}>{formatDateTime(event.dateTime)}</Text>
      {event.location ? <Text style={styles.location}>{event.location}</Text> : null}

      {/* Action bar: Share + Randomize + Settings + Rankings + Calendar */}
      <View style={styles.actionBar}>
        <TouchableOpacity style={styles.actionBtn} onPress={handleShare}>
          <Text style={styles.actionBtnText}>📤 {t("shareGame")}</Text>
        </TouchableOpacity>
        {activePlayers.length >= 2 && (
          <TouchableOpacity style={styles.actionBtn} onPress={handleRandomize}>
            <Text style={styles.actionBtnText}>🎲 {t("randomizeTeams")}</Text>
          </TouchableOpacity>
        )}
        {(isOwner || event.isAdmin) && (
          <TouchableOpacity style={styles.actionBtn} onPress={() => router.push(`/event/${id}/settings`)}>
            <Text style={styles.actionBtnText}>⚙️</Text>
          </TouchableOpacity>
        )}
        {event.eloEnabled && (
          <TouchableOpacity style={styles.actionBtn} onPress={() => router.push(`/event/${id}/rankings`)}>
            <Text style={styles.actionBtnText}>🏆 Rankings</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.actionBtn} onPress={() => router.push(`/event/${id}/calendar`)}>
          <Text style={styles.actionBtnText}>📅</Text>
        </TouchableOpacity>
      </View>

      {/* Quick Join */}
      {isAuthenticated && user?.name && (
        <View style={styles.quickJoin}>
          {myPlayer ? (
            <View style={styles.quickJoinRow}>
              <Text style={[styles.quickJoinStatus, isOnBench && { color: colors.warning }]}>
                {isOnBench ? t("youAreOnBench") : t("youArePlaying", { name: myPlayer.name })}
              </Text>
              <TouchableOpacity style={styles.leaveBtn} onPress={handleQuickLeave} disabled={adding}>
                <Text style={styles.leaveBtnText}>{t("quickJoinLeave")}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              style={styles.joinBtn}
              onPress={handleQuickJoin}
              disabled={adding}
            >
              <Text style={styles.joinBtnText}>
                {adding ? "..." : `${t("quickJoinBtn")} (${user.name})`}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Undo banner */}
      {undoData && (
        <TouchableOpacity style={styles.undoBanner} onPress={handleUndo}>
          <Text style={styles.undoText}>
            {undoData.name} removed — tap to undo
          </Text>
        </TouchableOpacity>
      )}

      {/* Teams */}
      {event.teamResults && event.teamResults.length === 2 && (
        <View style={styles.teamsContainer}>
          <View style={styles.teamCol}>
            <Text style={styles.teamName}>{event.teamResults[0].name}</Text>
            {event.teamResults[0].members.map((m) => (
              <Text key={m.id} style={styles.teamPlayer}>{m.name}</Text>
            ))}
          </View>
          <Text style={styles.vs}>{t("vs")}</Text>
          <View style={styles.teamCol}>
            <Text style={styles.teamName}>{event.teamResults[1].name}</Text>
            {event.teamResults[1].members.map((m) => (
              <Text key={m.id} style={styles.teamPlayer}>{m.name}</Text>
            ))}
          </View>
        </View>
      )}

      {/* Players */}
      <Text style={styles.sectionTitle}>
        {t("playing", { n: activePlayers.length, max: event.maxPlayers })}
      </Text>
      {activePlayers.map((p) => (
        <TouchableOpacity
          key={p.id}
          style={styles.playerRow}
          onLongPress={() => canRemove(p) && handleRemovePlayer(p.id, p.name)}
          onPress={() => canClaimPlayer && !p.userId ? handleClaimPlayer(p.id, p.name) : undefined}
          accessibilityLabel={`${p.name}${p.userId === user?.id ? " (you)" : ""}`}
        >
          <Text style={styles.playerName}>
            {p.name}
            {p.userId === user?.id ? " ✓" : ""}
          </Text>
          {!p.userId && canClaimPlayer && (
            <Text style={styles.claimHint}>Tap to claim</Text>
          )}
        </TouchableOpacity>
      ))}

      {benchPlayers.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>{t("bench", { n: benchPlayers.length })}</Text>
          {benchPlayers.map((p) => (
            <TouchableOpacity
              key={p.id}
              style={styles.playerRow}
              onLongPress={() => canRemove(p) && handleRemovePlayer(p.id, p.name)}
            >
              <Text style={[styles.playerName, { color: colors.textMuted }]}>{p.name}</Text>
            </TouchableOpacity>
          ))}
        </>
      )}

      {/* Add player with suggestions */}
      {suggestions.length > 0 && !newPlayer.trim() && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.suggestionsRow}>
          {suggestions.map((s) => (
            <TouchableOpacity
              key={s.name}
              style={styles.suggestionChip}
              onPress={async () => {
                setAdding(true);
                try {
                  await addPlayer(id!, s.name);
                  await load();
                } catch (e: any) {
                  Alert.alert(t("somethingWentWrong"), e.message);
                } finally {
                  setAdding(false);
                }
              }}
            >
              <Text style={styles.suggestionText}>{s.name}</Text>
              <Text style={styles.suggestionMeta}>{s.gamesPlayed}g</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      <View style={styles.addRow}>
        <TextInput
          style={styles.input}
          value={newPlayer}
          onChangeText={setNewPlayer}
          placeholder={t("addPlayerPlaceholder")}
          placeholderTextColor={colors.textMuted}
          onSubmitEditing={handleAddPlayer}
          returnKeyType="done"
        />
        <TouchableOpacity
          style={[styles.addBtn, (!newPlayer.trim() || adding) && { opacity: 0.4 }]}
          onPress={handleAddPlayer}
          disabled={!newPlayer.trim() || adding}
        >
          <Text style={styles.addBtnText}>{adding ? "..." : t("add")}</Text>
        </TouchableOpacity>
      </View>

      {/* Post-game banner */}
      {postGame && (postGame.gameEnded || postGame.hasPendingPastPayments) && !postGame.allComplete && (
        <View style={styles.postGameBanner}>
          <Text style={styles.postGameTitle}>🏁 Game ended</Text>
          {!postGame.hasScore && postGame.latestHistoryId && (
            <TouchableOpacity
              style={styles.postGameBtn}
              onPress={() => {
                setEditingScore(postGame.latestHistoryId!);
                setScoreOne(""); setScoreTwo("");
              }}
            >
              <Text style={styles.postGameBtnText}>+ Record score</Text>
            </TouchableOpacity>
          )}
          {postGame.hasCost && !postGame.allPaid && (
            <TouchableOpacity
              style={styles.postGameBtn}
              onPress={() => router.push(`/event/${id}/payments`)}
            >
              <Text style={styles.postGameBtnText}>💰 Mark payments</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* History */}
      {history.length > 0 && (
        <>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{t("history")}</Text>
            <TouchableOpacity onPress={() => router.push(`/event/${id}/log`)}>
              <Text style={styles.sectionLink}>View log →</Text>
            </TouchableOpacity>
          </View>
          {history.map((h) => (
            <View key={h.id} style={styles.historyCard}>
              <Text style={styles.historyDate}>{formatDateTime(h.dateTime)}</Text>
              {h.scoreOne != null && h.scoreTwo != null ? (
                <TouchableOpacity onPress={() => {
                  if (h.editable) {
                    setEditingScore(h.id);
                    setScoreOne(String(h.scoreOne));
                    setScoreTwo(String(h.scoreTwo));
                  }
                }}>
                  <Text style={styles.historyScore}>
                    {h.teamOneName} {h.scoreOne} - {h.scoreTwo} {h.teamTwoName}
                  </Text>
                </TouchableOpacity>
              ) : h.editable ? (
                editingScore === h.id ? (
                  <View style={styles.scoreEditRow}>
                    <TextInput
                      style={styles.scoreInput}
                      value={scoreOne}
                      onChangeText={setScoreOne}
                      keyboardType="number-pad"
                      placeholder="0"
                      placeholderTextColor={colors.textMuted}
                    />
                    <Text style={styles.scoreDash}>-</Text>
                    <TextInput
                      style={styles.scoreInput}
                      value={scoreTwo}
                      onChangeText={setScoreTwo}
                      keyboardType="number-pad"
                      placeholder="0"
                      placeholderTextColor={colors.textMuted}
                    />
                    <TouchableOpacity
                      style={styles.scoreSaveBtn}
                      onPress={() => handleSaveScore(h.id)}
                    >
                      <Text style={styles.scoreSaveBtnText}>{t("save")}</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity onPress={() => {
                    setEditingScore(h.id);
                    setScoreOne(""); setScoreTwo("");
                  }}>
                    <Text style={styles.addScoreText}>+ {t("score")}</Text>
                  </TouchableOpacity>
                )
              ) : (
                <Text style={styles.historyStatus}>{h.status}</Text>
              )}
              {h.eloUpdates && h.eloUpdates.length > 0 && (
                <View style={styles.eloRow}>
                  {h.eloUpdates.map((eu) => (
                    <Text key={eu.name} style={[
                      styles.eloChip,
                      { color: eu.delta > 0 ? colors.success : eu.delta < 0 ? colors.error : colors.textMuted },
                    ]}>
                      {eu.name} {eu.delta > 0 ? "+" : ""}{eu.delta}
                    </Text>
                  ))}
                </View>
              )}
            </View>
          ))}
          {historyHasMore && (
            <TouchableOpacity style={styles.loadMoreBtn} onPress={loadMoreHistory} disabled={loadingMoreHistory}>
              <Text style={styles.loadMoreText}>
                {loadingMoreHistory ? "Loading…" : t("loadMore")}
              </Text>
            </TouchableOpacity>
          )}
        </>
      )}

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
  errorText: { color: colors.error, fontSize: 14, marginBottom: 12 },
  backBtn: { paddingVertical: 8 },
  backText: { color: colors.primary, fontWeight: "600" },
  title: { color: colors.text, fontSize: 22, fontWeight: "800", marginBottom: 4 },
  meta: { color: colors.textSecondary, fontSize: 14, marginBottom: 2 },
  location: { color: colors.textMuted, fontSize: 13, marginBottom: 8 },

  // Action bar
  actionBar: { flexDirection: "row", gap: 8, marginVertical: 12 },
  actionBtn: {
    backgroundColor: colors.surface, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 10,
    borderWidth: 1, borderColor: colors.border, flex: 1, alignItems: "center",
  },
  actionBtnText: { color: colors.text, fontSize: 13, fontWeight: "600" },

  // Quick join
  quickJoin: {
    backgroundColor: colors.surface, borderRadius: 12, padding: 14,
    marginBottom: 12, borderWidth: 1, borderColor: colors.primaryDark,
  },
  quickJoinRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  quickJoinStatus: { color: colors.success, fontSize: 14, fontWeight: "600", flex: 1 },
  joinBtn: {
    backgroundColor: colors.primary, borderRadius: 10,
    padding: 14, alignItems: "center",
  },
  joinBtnText: { color: colors.onPrimary, fontSize: 15, fontWeight: "700" },
  leaveBtn: {
    borderWidth: 1, borderColor: colors.error, borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  leaveBtnText: { color: colors.error, fontSize: 13, fontWeight: "600" },

  // Undo
  undoBanner: {
    backgroundColor: colors.surfaceHover, borderRadius: 10, padding: 12,
    marginBottom: 12, borderWidth: 1, borderColor: colors.primary,
  },
  undoText: { color: colors.primary, fontSize: 13, fontWeight: "600", textAlign: "center" },

  // Teams
  teamsContainer: {
    flexDirection: "row", backgroundColor: colors.surface, borderRadius: 12,
    padding: 14, marginBottom: 12, borderWidth: 1, borderColor: colors.border,
    alignItems: "flex-start",
  },
  teamCol: { flex: 1, alignItems: "center" },
  teamName: {
    color: colors.primary, fontSize: 13, fontWeight: "700",
    marginBottom: 6, textTransform: "uppercase",
  },
  teamPlayer: { color: colors.textSecondary, fontSize: 13, marginBottom: 2 },
  vs: { color: colors.textMuted, fontWeight: "700", fontSize: 12, marginHorizontal: 8, marginTop: 16 },

  // Players
  sectionTitle: {
    color: colors.primary, fontSize: 13, fontWeight: "700",
    textTransform: "uppercase", letterSpacing: 1,
    marginBottom: 8, marginTop: 16,
  },
  playerRow: {
    backgroundColor: colors.surface, borderRadius: 8,
    paddingHorizontal: 14, paddingVertical: 10, marginBottom: 4,
    borderWidth: 1, borderColor: colors.border,
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
  },
  playerName: { color: colors.text, fontSize: 14 },
  claimHint: { color: colors.textMuted, fontSize: 11 },

  // Suggestions
  suggestionsRow: { flexDirection: "row", marginTop: 12, marginBottom: 4 },
  suggestionChip: {
    backgroundColor: colors.surface, borderRadius: 20,
    paddingHorizontal: 12, paddingVertical: 6, marginRight: 8,
    borderWidth: 1, borderColor: colors.border,
    flexDirection: "row", alignItems: "center", gap: 4,
  },
  suggestionText: { color: colors.text, fontSize: 13 },
  suggestionMeta: { color: colors.textMuted, fontSize: 11 },

  // Add player
  addRow: { flexDirection: "row", gap: 8, marginTop: 12 },
  input: {
    flex: 1, backgroundColor: colors.surfaceHover, color: colors.text,
    borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14,
  },
  addBtn: {
    backgroundColor: colors.primaryDark, borderRadius: 8,
    paddingHorizontal: 16, justifyContent: "center",
  },
  addBtnText: { color: colors.primaryContainer, fontWeight: "700" },

  // History
  historyCard: {
    backgroundColor: colors.surface, borderRadius: 8, padding: 12,
    marginBottom: 6, borderWidth: 1, borderColor: colors.border,
  },
  historyDate: { color: colors.textMuted, fontSize: 12, marginBottom: 4 },
  historyScore: { color: colors.text, fontSize: 15, fontWeight: "700" },
  historyStatus: { color: colors.textSecondary, fontSize: 13 },
  addScoreText: { color: colors.primary, fontSize: 13, fontWeight: "600" },

  // Score editing
  scoreEditRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  scoreInput: {
    backgroundColor: colors.surfaceHover, color: colors.text,
    borderRadius: 6, paddingHorizontal: 12, paddingVertical: 6,
    fontSize: 16, fontWeight: "700", width: 50, textAlign: "center",
  },
  scoreDash: { color: colors.textMuted, fontSize: 16, fontWeight: "700" },
  scoreSaveBtn: {
    backgroundColor: colors.primaryDark, borderRadius: 6,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  scoreSaveBtnText: { color: colors.primaryContainer, fontWeight: "600", fontSize: 13 },

  // ELO
  eloRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 },
  eloChip: { fontSize: 11, fontWeight: "600" },

  // Post-game banner
  postGameBanner: {
    backgroundColor: colors.surfaceHover, borderRadius: 12, padding: 14,
    marginBottom: 12, borderWidth: 1, borderColor: colors.primary,
    gap: 8,
  },
  postGameTitle: { color: colors.primary, fontSize: 14, fontWeight: "700" },
  postGameBtn: {
    backgroundColor: colors.primaryDark, borderRadius: 8,
    paddingHorizontal: 14, paddingVertical: 8, alignSelf: "flex-start",
  },
  postGameBtnText: { color: colors.primaryContainer, fontSize: 13, fontWeight: "600" },

  // Load more
  loadMoreBtn: {
    backgroundColor: colors.surface, borderRadius: 8, padding: 12,
    alignItems: "center", marginTop: 8,
    borderWidth: 1, borderColor: colors.border,
  },
  loadMoreText: { color: colors.primary, fontSize: 13, fontWeight: "600" },

  // Section header with link
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  sectionLink: { color: colors.primary, fontSize: 13, fontWeight: "600", paddingVertical: 4 },
});
