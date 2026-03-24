import { useState, useEffect, useCallback, useRef } from "react";
import type { WatchEvent } from "./watchTypes";
import { savePendingSync, flushPendingSyncs } from "./watchTypes";
import { t, watchBase, surfaceBtn, TAP_MIN_CSS } from "./watchTheme";

interface Props {
  eventId: string;
}

/** Auto-save debounce delay in ms */
const SAVE_DELAY = 800;

/**
 * Score tracker screen — M3 dark theme, optimised for round & square watches.
 * Large circular +/- buttons, centered layout safe for round bezels.
 * Auto-saves on every score change (debounced).
 */
export default function WatchScoreTracker({ eventId }: Props) {
  const [event, setEvent] = useState<WatchEvent | null>(null);
  const [scoreOne, setScoreOne] = useState(0);
  const [scoreTwo, setScoreTwo] = useState(0);
  const [loading, setLoading] = useState(true);
  const [syncStatus, setSyncStatus] = useState<"idle" | "saving" | "saved" | "offline">("idle");
  const [error, setError] = useState<string | null>(null);

  // Refs for debounced auto-save
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestScores = useRef({ scoreOne: 0, scoreTwo: 0 });
  const initialLoad = useRef(true);

  useEffect(() => {
    let cancelled = false;

    async function loadEvent() {
      try {
        const r = await fetch(`/api/watch/events?eventId=${eventId}`);
        if (!r.ok) throw new Error("Not found");
        const data: WatchEvent = await r.json();

        // If the event has teams but no history, auto-create a game history record
        if (data.hasTeams && !data.latestGame) {
          const createRes = await fetch("/api/watch/events", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ eventId }),
          });

          if (createRes.ok) {
            const created = await createRes.json();
            data.latestGame = {
              id: created.id,
              scoreOne: created.scoreOne,
              scoreTwo: created.scoreTwo,
              teamOneName: created.teamOneName,
              teamTwoName: created.teamTwoName,
              editable: created.editable,
            };
          }
        }

        if (!cancelled) {
          setEvent(data);
          const s1 = data.latestGame?.scoreOne ?? 0;
          const s2 = data.latestGame?.scoreTwo ?? 0;
          setScoreOne(s1);
          setScoreTwo(s2);
          latestScores.current = { scoreOne: s1, scoreTwo: s2 };
          // Mark initial load done after a tick so the first setState doesn't trigger save
          setTimeout(() => { initialLoad.current = false; }, 50);
        }
      } catch {
        if (!cancelled) setError("Could not load event");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadEvent();
    return () => { cancelled = true; };
  }, [eventId]);

  // Auto-save whenever scores change (debounced)
  const doSave = useCallback(async () => {
    if (!event?.latestGame) return;
    const { scoreOne: s1, scoreTwo: s2 } = latestScores.current;
    const historyId = event.latestGame.id;

    setSyncStatus("saving");

    try {
      const res = await fetch(`/api/events/${eventId}/history/${historyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scoreOne: s1, scoreTwo: s2 }),
      });

      if (res.ok) {
        setSyncStatus("saved");
      } else {
        throw new Error("Server error");
      }
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
  }, [event, eventId]);

  // Trigger debounced save on score change
  useEffect(() => {
    if (initialLoad.current) return;
    if (!event?.latestGame) return;

    latestScores.current = { scoreOne, scoreTwo };
    setSyncStatus("idle");

    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { doSave(); }, SAVE_DELAY);

    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [scoreOne, scoreTwo, doSave, event]);

  // Flush pending syncs when coming online
  useEffect(() => {
    const flush = () => { flushPendingSyncs(); };
    window.addEventListener("online", flush);
    return () => window.removeEventListener("online", flush);
  }, []);

  const inc = useCallback((team: 1 | 2) => {
    if (team === 1) setScoreOne((s) => s + 1);
    else setScoreTwo((s) => s + 1);
  }, []);

  const dec = useCallback((team: 1 | 2) => {
    if (team === 1) setScoreOne((s) => Math.max(0, s - 1));
    else setScoreTwo((s) => Math.max(0, s - 1));
  }, []);

  /* ── Loading / error states ─────────────────────────────────── */

  if (loading) {
    return (
      <div style={{ ...watchBase, justifyContent: "center" }}>
        <div style={styles.spinner} />
        <p style={styles.statusMsg}>Loading…</p>
      </div>
    );
  }

  if (error && !event) {
    return (
      <div style={{ ...watchBase, justifyContent: "center" }}>
        <p style={{ ...styles.statusMsg, color: t.error }}>{error}</p>
        <a href="/watch/" style={styles.backLink}>Back</a>
      </div>
    );
  }

  if (!event) {
    return (
      <div style={{ ...watchBase, justifyContent: "center" }}>
        <p style={styles.statusMsg}>Event not found</p>
        <a href="/watch/" style={styles.backLink}>Back</a>
      </div>
    );
  }

  const teamA = event.latestGame?.teamOneName ?? event.teamOneName;
  const teamB = event.latestGame?.teamTwoName ?? event.teamTwoName;
  const noGame = !event.latestGame;

  /* ── Main UI ────────────────────────────────────────────────── */

  return (
    <div style={{ ...watchBase, justifyContent: "center", gap: 2 }}>
      {/* Back button — top-left, safe for round bezels */}
      <a href="/watch/" style={styles.backBtn} aria-label="Back to game list">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <path d="M15 19l-7-7 7-7" stroke={t.primary} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </a>

      {/* Sync status indicator — top-right */}
      <div style={styles.syncIndicator}>
        {syncStatus === "saving" && <div style={{ ...styles.spinnerSmall }} />}
        {syncStatus === "saved" && (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path d="M5 13l4 4L19 7" stroke={t.primary} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
        {syncStatus === "offline" && (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke={t.warning} strokeWidth="2" />
            <path d="M12 8v4m0 4h.01" stroke={t.warning} strokeWidth="2" strokeLinecap="round" />
          </svg>
        )}
      </div>

      {/* No-game warning */}
      {noGame && (
        <div style={styles.warningChip}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
            <path d="M12 9v4m0 4h.01M12 2L2 20h20L12 2z" stroke={t.warning} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>Start game from main app</span>
        </div>
      )}

      {/* ── Team A ──────────────────────────────────────────── */}
      <TeamScoreRow
        teamName={teamA}
        score={scoreOne}
        onInc={() => inc(1)}
        onDec={() => dec(1)}
        disabled={noGame}
        ariaPrefix={teamA}
      />

      {/* Divider */}
      <div style={styles.divider}>
        <span style={styles.vs}>VS</span>
      </div>

      {/* ── Team B ──────────────────────────────────────────── */}
      <TeamScoreRow
        teamName={teamB}
        score={scoreTwo}
        onInc={() => inc(2)}
        onDec={() => dec(2)}
        disabled={noGame}
        ariaPrefix={teamB}
      />

      {/* Offline note at bottom */}
      {syncStatus === "offline" && (
        <span style={styles.offlineChip}>Saved offline — will sync later</span>
      )}
    </div>
  );
}

/* ── Team score row sub-component ──────────────────────────────── */

function TeamScoreRow({
  teamName,
  score,
  onInc,
  onDec,
  disabled,
  ariaPrefix,
}: {
  teamName: string;
  score: number;
  onInc: () => void;
  onDec: () => void;
  disabled: boolean;
  ariaPrefix: string;
}) {
  return (
    <div style={styles.teamBlock}>
      <span style={styles.teamName}>{teamName}</span>
      <div style={styles.controlRow}>
        <button
          style={{
            ...surfaceBtn,
            width: TAP_MIN_CSS,
            height: TAP_MIN_CSS,
            fontSize: "clamp(16px, 12vw, 22px)",
            ...(disabled || score === 0 ? { opacity: 0.3, pointerEvents: "none" as const } : {}),
          }}
          onClick={onDec}
          disabled={disabled || score === 0}
          aria-label={`Decrease ${ariaPrefix} score`}
        >
          −
        </button>

        <span style={styles.scoreDisplay}>{score}</span>

        <button
          style={{
            ...surfaceBtn,
            width: TAP_MIN_CSS,
            height: TAP_MIN_CSS,
            fontSize: "clamp(16px, 12vw, 22px)",
            ...(disabled ? { opacity: 0.3, pointerEvents: "none" as const } : {}),
          }}
          onClick={onInc}
          disabled={disabled}
          aria-label={`Increase ${ariaPrefix} score`}
        >
          +
        </button>
      </div>
    </div>
  );
}

/* ── Styles ─────────────────────────────────────────────────────── */

const styles: Record<string, React.CSSProperties> = {
  statusMsg: {
    textAlign: "center",
    color: t.onSurfaceVariant,
    fontSize: "clamp(11px, 7vw, 13px)",
  },
  backBtn: {
    position: "absolute",
    top: "env(safe-area-inset-top, 8px)",
    left: "env(safe-area-inset-left, 8px)",
    width: "clamp(28px, 18vw, 36px)",
    height: "clamp(28px, 18vw, 36px)",
    borderRadius: "50%",
    background: t.surfaceContainerHigh,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    textDecoration: "none",
    zIndex: 10,
  },
  backLink: {
    color: t.primary,
    textDecoration: "none",
    fontSize: "clamp(11px, 7vw, 13px)",
    fontWeight: 600,
    marginTop: 8,
  },
  syncIndicator: {
    position: "absolute",
    top: "env(safe-area-inset-top, 8px)",
    right: "env(safe-area-inset-right, 8px)",
    width: "clamp(22px, 14vw, 28px)",
    height: "clamp(22px, 14vw, 28px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
  },
  warningChip: {
    display: "flex",
    alignItems: "center",
    gap: "clamp(3px, 2vw, 5px)",
    background: t.warningContainer,
    color: t.warning,
    fontSize: "clamp(8px, 5vw, 10px)",
    fontWeight: 600,
    borderRadius: 9999,
    padding: "2px clamp(6px, 4vw, 10px)",
    marginBottom: 2,
  },
  teamBlock: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "clamp(0px, 0.5vw, 2px)",
    width: "100%",
    maxWidth: "min(220px, 92vw)",
  },
  teamName: {
    fontWeight: 600,
    fontSize: "clamp(9px, 6vw, 12px)",
    color: t.onSurfaceVariant,
    textAlign: "center",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    maxWidth: "90%",
    letterSpacing: "0.02em",
    textTransform: "uppercase",
  },
  controlRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "clamp(4px, 3vw, 12px)",
  },
  scoreDisplay: {
    fontWeight: 800,
    fontSize: "clamp(24px, 20vw, 36px)",
    color: t.primary,
    minWidth: "clamp(32px, 22vw, 48px)",
    textAlign: "center",
    lineHeight: 1,
    fontVariantNumeric: "tabular-nums",
  },
  divider: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    maxWidth: "min(200px, 85vw)",
    margin: "0 auto",
    position: "relative",
  },
  vs: {
    fontSize: "clamp(8px, 5vw, 10px)",
    fontWeight: 700,
    color: t.outline,
    letterSpacing: "0.1em",
    background: t.surface,
    padding: "0 clamp(4px, 3vw, 8px)",
    zIndex: 1,
  },
  offlineChip: {
    display: "inline-flex",
    alignItems: "center",
    fontSize: "clamp(8px, 5vw, 10px)",
    color: t.warning,
    marginTop: "clamp(2px, 1vw, 4px)",
  },
  spinner: {
    width: 20,
    height: 20,
    border: `3px solid ${t.outlineVariant}`,
    borderTopColor: t.primary,
    borderRadius: "50%",
    animation: "spin 0.8s linear infinite",
  },
  spinnerSmall: {
    width: 14,
    height: 14,
    border: `2px solid ${t.outlineVariant}`,
    borderTopColor: t.primary,
    borderRadius: "50%",
    animation: "spin 0.8s linear infinite",
  },
};
