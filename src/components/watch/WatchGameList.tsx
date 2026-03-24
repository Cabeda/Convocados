import { useState, useEffect } from "react";
import type { WatchEvent, WatchEventsResponse } from "./watchTypes";
import { flushPendingSyncs, getPendingSyncs } from "./watchTypes";
import { t, watchBase, card, TAP_MIN_CSS } from "./watchTheme";

/**
 * Game list screen — M3 dark theme, optimised for round & square smartwatches.
 * Shows today's events; tappable only when teams are assigned.
 */
export default function WatchGameList() {
  const [events, setEvents] = useState<WatchEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    // Skip auto-select when the user navigated back from a game screen
    const cameFromGame = document.referrer && new URL(document.referrer, location.origin).pathname.startsWith("/watch/") && new URL(document.referrer, location.origin).pathname !== "/watch/";

    fetch("/api/watch/events")
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load");
        return r.json() as Promise<WatchEventsResponse>;
      })
      .then((data) => {
        setEvents(data.events);
        if (data.autoSelectId && !cameFromGame) {
          window.location.href = `/watch/${data.autoSelectId}`;
        }
      })
      .catch(() => setError("Offline — no cached data"))
      .finally(() => setLoading(false));

    getPendingSyncs().then((p) => setPendingCount(p.length));
  }, []);

  useEffect(() => {
    const flush = () => {
      flushPendingSyncs().then((n) => {
        if (n > 0) getPendingSyncs().then((p) => setPendingCount(p.length));
      });
    };
    window.addEventListener("online", flush);
    flush();
    return () => window.removeEventListener("online", flush);
  }, []);

  return (
    <div style={{ ...watchBase, gap: "clamp(4px, 3vw, 8px)" }}>
      {/* Header */}
      <div style={styles.header}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ marginRight: 6 }}>
          <circle cx="12" cy="12" r="10" stroke={t.primary} strokeWidth="2" />
          <path d="M12 6v6l4 2" stroke={t.primary} strokeWidth="2" strokeLinecap="round" />
        </svg>
        <span style={styles.headerText}>Today</span>
      </div>

      {/* Pending sync banner */}
      {pendingCount > 0 && (
        <div style={styles.pendingBanner}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ marginRight: 4, flexShrink: 0 }}>
            <path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83" stroke={t.warning} strokeWidth="2" strokeLinecap="round" />
          </svg>
          {pendingCount} pending
        </div>
      )}

      {/* States */}
      {loading && <p style={styles.statusMsg}>Loading…</p>}
      {error && <p style={{ ...styles.statusMsg, color: t.error }}>{error}</p>}
      {!loading && !error && events.length === 0 && (
        <div style={styles.emptyState}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
            <rect x="3" y="4" width="18" height="16" rx="3" stroke={t.outline} strokeWidth="1.5" />
            <path d="M3 9h18" stroke={t.outline} strokeWidth="1.5" />
            <circle cx="12" cy="14.5" r="1" fill={t.outline} />
          </svg>
          <span style={{ color: t.onSurfaceVariant, fontSize: "clamp(10px, 6vw, 12px)", marginTop: 4 }}>No games today</span>
        </div>
      )}

      {/* Event cards */}
      {events.map((ev) => (
        <EventCard key={ev.id} event={ev} />
      ))}
    </div>
  );
}

function EventCard({ event: ev }: { event: WatchEvent }) {
  const disabled = !ev.hasTeams;
  const Wrapper = disabled ? "div" : "a";

  return (
    <Wrapper
      {...(disabled ? {} : { href: `/watch/${ev.id}` })}
      style={{
        ...card,
        ...(ev.isHappeningNow && !disabled ? { borderColor: t.primary } : {}),
        ...(disabled ? { opacity: 0.45, pointerEvents: "none" as const } : {}),
        minHeight: TAP_MIN_CSS,
      }}
      aria-disabled={disabled}
    >
      {/* Top row: title + live badge */}
      <div style={styles.cardTop}>
        <span style={styles.cardTitle}>{ev.title}</span>
        {ev.isHappeningNow && (
          <span style={styles.liveBadge}>
            <span style={styles.liveDot} />
            LIVE
          </span>
        )}
      </div>

      {/* Bottom row: score or status */}
      {disabled ? (
        <span style={styles.cardSub}>No teams yet</span>
      ) : ev.latestGame ? (
        <div style={styles.scoreRow}>
          <span style={styles.scoreTeam}>{ev.latestGame.teamOneName}</span>
          <span style={styles.scoreBig}>
            {ev.latestGame.scoreOne} – {ev.latestGame.scoreTwo}
          </span>
          <span style={styles.scoreTeam}>{ev.latestGame.teamTwoName}</span>
        </div>
      ) : (
        <span style={styles.cardSub}>Tap to start scoring</span>
      )}
    </Wrapper>
  );
}

/* ── Styles ─────────────────────────────────────────────────────── */

const styles: Record<string, React.CSSProperties> = {
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    paddingTop: "clamp(2px, 1vw, 4px)",
    paddingBottom: 2,
  },
  headerText: {
    fontSize: "clamp(12px, 8vw, 15px)",
    fontWeight: 700,
    letterSpacing: "0.02em",
    color: t.onSurface,
  },
  pendingBanner: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: t.warningContainer,
    color: t.warning,
    fontSize: "clamp(9px, 6vw, 11px)",
    fontWeight: 600,
    borderRadius: 9999,
    padding: "clamp(2px, 1.5vw, 4px) clamp(8px, 5vw, 12px)",
    width: "fit-content",
  },
  statusMsg: {
    textAlign: "center",
    color: t.onSurfaceVariant,
    fontSize: "clamp(11px, 7vw, 13px)",
    margin: "clamp(8px, 5vw, 16px) 0",
  },
  emptyState: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    flex: 1,
    gap: 2,
    marginTop: "clamp(12px, 8vw, 24px)",
  },
  cardTop: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "clamp(3px, 2vw, 6px)",
  },
  cardTitle: {
    fontWeight: 600,
    fontSize: "clamp(10px, 7vw, 13px)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    flex: 1,
  },
  liveBadge: {
    display: "inline-flex",
    alignItems: "center",
    gap: "clamp(2px, 1.5vw, 4px)",
    fontSize: "clamp(7px, 5vw, 9px)",
    fontWeight: 700,
    letterSpacing: "0.06em",
    color: t.error,
    background: t.errorContainer,
    borderRadius: 9999,
    padding: "2px clamp(4px, 3vw, 7px) 2px clamp(3px, 2vw, 5px)",
    flexShrink: 0,
  },
  liveDot: {
    width: "clamp(4px, 2.5vw, 5px)",
    height: "clamp(4px, 2.5vw, 5px)",
    borderRadius: "50%",
    background: t.error,
    animation: "pulse 1.5s infinite",
  },
  scoreRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "clamp(2px, 1.5vw, 4px)",
    marginTop: 2,
  },
  scoreTeam: {
    fontSize: "clamp(8px, 5vw, 10px)",
    color: t.onSurfaceVariant,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    maxWidth: "30%",
  },
  scoreBig: {
    fontWeight: 700,
    fontSize: "clamp(12px, 8vw, 16px)",
    color: t.primary,
    letterSpacing: "0.04em",
  },
  cardSub: {
    fontSize: "clamp(9px, 6vw, 11px)",
    color: t.onSurfaceVariant,
    marginTop: 2,
  },
};
