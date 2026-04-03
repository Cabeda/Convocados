/**
 * WearOS Score Tracker component.
 *
 * Offline-first: saves scores locally and syncs when connected.
 * Designed for small round/square watch screens.
 * Mirrors the web watch PWA (WatchScoreTracker.tsx) but native.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { fetchEvent, updateScore } from "~/api/endpoints";
import { savePendingSync } from "../offlineStorage";
import { startSyncListener } from "../syncEngine";
import type { EventDetail } from "~/types/api";

const SAVE_DELAY = 800;

interface Props {
  eventId: string;
  onBack?: () => void;
}

export function WearScoreTracker({ eventId, onBack }: Props) {
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [scoreOne, setScoreOne] = useState(0);
  const [scoreTwo, setScoreTwo] = useState(0);
  const [loading, setLoading] = useState(true);
  const [syncStatus, setSyncStatus] = useState<"idle" | "saving" | "saved" | "offline">("idle");
  const [error, setError] = useState<string | null>(null);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestScores = useRef({ scoreOne: 0, scoreTwo: 0 });
  const initialLoad = useRef(true);

  // Start sync listener for offline recovery
  useEffect(() => {
    const unsub = startSyncListener((count) => {
      if (count > 0) setSyncStatus("saved");
    });
    return unsub;
  }, []);

  // Load event data
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ev = await fetchEvent(eventId);
        if (cancelled) return;
        setEvent(ev);

        // TODO: fetch latest history entry for scores
        // For now, start at 0-0
        setTimeout(() => { initialLoad.current = false; }, 50);
      } catch {
        if (!cancelled) setError("Could not load event");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [eventId]);

  // Auto-save on score change (debounced)
  const doSave = useCallback(async () => {
    if (!historyId) return;
    const { scoreOne: s1, scoreTwo: s2 } = latestScores.current;
    setSyncStatus("saving");

    try {
      await updateScore(eventId, historyId, s1, s2);
      setSyncStatus("saved");
    } catch {
      await savePendingSync({
        eventId,
        historyId,
        scoreOne: s1,
        scoreTwo: s2,
        timestamp: Date.now(),
      });
      setSyncStatus("offline");
    }
  }, [eventId, historyId]);

  useEffect(() => {
    if (initialLoad.current || !historyId) return;
    latestScores.current = { scoreOne, scoreTwo };
    setSyncStatus("idle");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(doSave, SAVE_DELAY);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [scoreOne, scoreTwo, doSave, historyId]);

  const inc = useCallback((team: 1 | 2) => {
    if (team === 1) setScoreOne((s) => s + 1);
    else setScoreTwo((s) => s + 1);
  }, []);

  const dec = useCallback((team: 1 | 2) => {
    if (team === 1) setScoreOne((s) => Math.max(0, s - 1));
    else setScoreTwo((s) => Math.max(0, s - 1));
  }, []);

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator color="#7edcab" />
      </View>
    );
  }

  if (error || !event) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>{error ?? "Not found"}</Text>
        {onBack && (
          <TouchableOpacity onPress={onBack}>
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  const teamA = event.teamOneName;
  const teamB = event.teamTwoName;
  const disabled = !historyId;

  return (
    <View style={styles.container}>
      {/* Sync indicator */}
      <View style={styles.syncRow}>
        {syncStatus === "saving" && <ActivityIndicator size="small" color="#7edcab" />}
        {syncStatus === "saved" && <Text style={styles.syncText}>Saved</Text>}
        {syncStatus === "offline" && <Text style={styles.offlineText}>Offline</Text>}
      </View>

      {/* Team A */}
      <Text style={styles.teamName}>{teamA}</Text>
      <View style={styles.scoreRow}>
        <TouchableOpacity
          style={[styles.btn, (disabled || scoreOne === 0) && styles.btnDisabled]}
          onPress={() => dec(1)}
          disabled={disabled || scoreOne === 0}
          accessibilityLabel={`Decrease ${teamA} score`}
        >
          <Text style={styles.btnText}>-</Text>
        </TouchableOpacity>
        <Text style={styles.score}>{scoreOne}</Text>
        <TouchableOpacity
          style={[styles.btn, disabled && styles.btnDisabled]}
          onPress={() => inc(1)}
          disabled={disabled}
          accessibilityLabel={`Increase ${teamA} score`}
        >
          <Text style={styles.btnText}>+</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.vs}>VS</Text>

      {/* Team B */}
      <Text style={styles.teamName}>{teamB}</Text>
      <View style={styles.scoreRow}>
        <TouchableOpacity
          style={[styles.btn, (disabled || scoreTwo === 0) && styles.btnDisabled]}
          onPress={() => dec(2)}
          disabled={disabled || scoreTwo === 0}
          accessibilityLabel={`Decrease ${teamB} score`}
        >
          <Text style={styles.btnText}>-</Text>
        </TouchableOpacity>
        <Text style={styles.score}>{scoreTwo}</Text>
        <TouchableOpacity
          style={[styles.btn, disabled && styles.btnDisabled]}
          onPress={() => inc(2)}
          disabled={disabled}
          accessibilityLabel={`Increase ${teamB} score`}
        >
          <Text style={styles.btnText}>+</Text>
        </TouchableOpacity>
      </View>

      {disabled && (
        <Text style={styles.warningText}>Start game from main app</Text>
      )}

      {syncStatus === "offline" && (
        <Text style={styles.offlineChip}>Saved offline — will sync later</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#111412",
    justifyContent: "center",
    alignItems: "center",
    padding: 8,
  },
  syncRow: {
    position: "absolute",
    top: 8,
    right: 8,
    flexDirection: "row",
    alignItems: "center",
  },
  syncText: { color: "#7edcab", fontSize: 10, fontWeight: "600" },
  offlineText: { color: "#f5bf48", fontSize: 10, fontWeight: "600" },
  teamName: {
    color: "#c2c9c1",
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 2,
  },
  scoreRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 4,
  },
  btn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#242724",
    justifyContent: "center",
    alignItems: "center",
  },
  btnDisabled: { opacity: 0.3 },
  btnText: { color: "#e1e3de", fontSize: 18, fontWeight: "700" },
  score: {
    color: "#7edcab",
    fontSize: 32,
    fontWeight: "800",
    minWidth: 40,
    textAlign: "center",
    fontVariant: ["tabular-nums"],
  },
  vs: {
    color: "#8c9389",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 2,
    marginVertical: 2,
  },
  errorText: { color: "#ffb4ab", fontSize: 12, marginBottom: 8 },
  backText: { color: "#7edcab", fontSize: 12, fontWeight: "600" },
  warningText: {
    color: "#f5bf48",
    fontSize: 10,
    marginTop: 8,
    textAlign: "center",
  },
  offlineChip: {
    color: "#f5bf48",
    fontSize: 9,
    marginTop: 4,
  },
});
