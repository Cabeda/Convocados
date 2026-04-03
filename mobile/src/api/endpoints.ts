/**
 * API endpoint functions — thin wrappers around the REST API.
 * Mirrors the server routes in src/pages/api/.
 */
import { apiGet, apiPost, apiPatch, apiDelete, apiFetch } from "./client";
import type {
  MyGamesResponse,
  EventDetail,
  EventStatus,
  GameHistory,
  PlayerStats,
  UserProfile,
  KnownPlayer,
  PublicEvent,
  PlayerRating,
  PaymentsResponse,
  PostGameStatus,
  NotificationPrefs,
  EventLogEntry,
  UserPublicProfile,
  AttendanceResult,
} from "~/types/api";

// ── User ──────────────────────────────────────────────────────────────────────

export function fetchMyGames(params?: {
  ownedCursor?: string;
  joinedCursor?: string;
}): Promise<MyGamesResponse> {
  const qs = new URLSearchParams();
  if (params?.ownedCursor) qs.set("ownedCursor", params.ownedCursor);
  if (params?.joinedCursor) qs.set("joinedCursor", params.joinedCursor);
  const q = qs.toString();
  return apiGet(`/api/me/games${q ? `?${q}` : ""}`);
}

export function fetchMyStats(): Promise<PlayerStats> {
  return apiGet("/api/me/stats");
}

export function fetchUserInfo(): Promise<UserProfile> {
  return apiGet("/api/me/profile");
}

// ── Events ────────────────────────────────────────────────────────────────────

export function createEvent(data: {
  title: string;
  location?: string;
  dateTime: string;
  timezone?: string;
  maxPlayers?: number;
  sport?: string;
  teamOneName?: string;
  teamTwoName?: string;
  isPublic?: boolean;
  isRecurring?: boolean;
  recurrenceFreq?: "daily" | "weekly" | "monthly" | "yearly";
  recurrenceInterval?: number;
  recurrenceByDay?: string;
}): Promise<{ id: string }> {
  return apiPost("/api/events", data);
}

export function fetchEvent(eventId: string): Promise<EventDetail> {
  return apiGet(`/api/events/${eventId}`);
}

export function fetchEventStatus(eventId: string): Promise<EventStatus> {
  return apiGet(`/api/events/${eventId}/status`);
}

export function addPlayer(
  eventId: string,
  name: string,
  linkToAccount = true,
): Promise<{ ok: boolean }> {
  return apiPost(`/api/events/${eventId}/players`, { name, linkToAccount });
}

export function removePlayer(
  eventId: string,
  playerId: string,
): Promise<{ ok: boolean; undo?: { name: string; order: number; userId: string | null; removedAt: number } }> {
  return apiDelete(`/api/events/${eventId}/players`, { playerId });
}

export function undoRemovePlayer(
  eventId: string,
  data: { name: string; order: number; userId: string | null; removedAt: number },
): Promise<{ ok: boolean }> {
  return apiPost(`/api/events/${eventId}/undo-remove`, data);
}

// ── Player operations ─────────────────────────────────────────────────────────

export function fetchKnownPlayers(
  eventId: string,
): Promise<{ players: KnownPlayer[] }> {
  return apiGet(`/api/events/${eventId}/known-players`);
}

export function claimPlayer(
  eventId: string,
  playerId: string,
): Promise<{ ok: boolean }> {
  return apiPost(`/api/events/${eventId}/claim-player`, { playerId });
}

export function reorderPlayers(
  eventId: string,
  playerIds: string[],
): Promise<{ ok: boolean }> {
  return apiFetch(`/api/events/${eventId}/reorder-players`, {
    method: "PUT",
    body: JSON.stringify({ playerIds }),
  }).then((r) => r.json());
}

// ── Teams ─────────────────────────────────────────────────────────────────────

export function randomizeTeams(
  eventId: string,
  balanced = false,
): Promise<{ ok: boolean }> {
  const qs = balanced ? "?balanced=true" : "";
  return apiPost(`/api/events/${eventId}/randomize${qs}`);
}

export function saveTeams(
  eventId: string,
  matches: { team: string; players: { name: string; order: number }[] }[],
): Promise<{ ok: boolean }> {
  return apiFetch(`/api/events/${eventId}/teams`, {
    method: "PUT",
    body: JSON.stringify({ matches }),
  }).then((r) => r.json());
}

export function saveTeamNames(
  eventId: string,
  teamOneName: string,
  teamTwoName: string,
): Promise<{ ok: boolean }> {
  return apiFetch(`/api/events/${eventId}/team-names`, {
    method: "PUT",
    body: JSON.stringify({ teamOneName, teamTwoName }),
  }).then((r) => r.json());
}

// ── Event editing ─────────────────────────────────────────────────────────────

export function updateTitle(
  eventId: string,
  title: string,
): Promise<{ ok: boolean }> {
  return apiFetch(`/api/events/${eventId}/title`, {
    method: "PUT",
    body: JSON.stringify({ title }),
  }).then((r) => r.json());
}

export function updateLocation(
  eventId: string,
  location: string,
): Promise<{ ok: boolean; geocoded?: boolean }> {
  return apiFetch(`/api/events/${eventId}/location`, {
    method: "PUT",
    body: JSON.stringify({ location }),
  }).then((r) => r.json());
}

export function updateDateTime(
  eventId: string,
  dateTime: string,
  timezone: string,
): Promise<{ ok: boolean }> {
  return apiFetch(`/api/events/${eventId}/datetime`, {
    method: "PUT",
    body: JSON.stringify({ dateTime, timezone }),
  }).then((r) => r.json());
}

export function updateSport(
  eventId: string,
  sport: string,
): Promise<{ ok: boolean }> {
  return apiFetch(`/api/events/${eventId}/sport`, {
    method: "PUT",
    body: JSON.stringify({ sport }),
  }).then((r) => r.json());
}

export function archiveEvent(
  eventId: string,
  archive: boolean,
): Promise<{ ok: boolean }> {
  return apiFetch(`/api/events/${eventId}/archive`, {
    method: archive ? "POST" : "DELETE",
  }).then((r) => r.json());
}

// ── History ───────────────────────────────────────────────────────────────────

export function fetchHistory(
  eventId: string,
  cursor?: string,
): Promise<{ data: GameHistory[]; nextCursor: string | null; hasMore: boolean }> {
  const qs = cursor ? `?cursor=${cursor}` : "";
  return apiGet(`/api/events/${eventId}/history${qs}`);
}

export function updateScore(
  eventId: string,
  historyId: string,
  scoreOne: number,
  scoreTwo: number,
): Promise<GameHistory> {
  return apiPatch(`/api/events/${eventId}/history/${historyId}`, {
    scoreOne,
    scoreTwo,
  });
}

// ── Ownership ─────────────────────────────────────────────────────────────────

export function claimOwnership(eventId: string): Promise<{ ok: boolean }> {
  return apiPost(`/api/events/${eventId}/claim`);
}

export function relinquishOwnership(eventId: string): Promise<{ ok: boolean }> {
  return apiDelete(`/api/events/${eventId}/claim`);
}

// ── Push tokens ───────────────────────────────────────────────────────────────

export function registerPushToken(
  token: string,
  platform: "ios" | "android",
): Promise<{ ok: boolean }> {
  return apiPost("/api/push/app-token", { token, platform });
}

export function unregisterPushToken(
  token: string,
): Promise<{ ok: boolean }> {
  return apiDelete("/api/push/app-token", { token });
}

// ── Public events ─────────────────────────────────────────────────────────────

export function fetchPublicEvents(cursor?: string): Promise<{
  data: PublicEvent[];
  nextCursor: string | null;
  hasMore: boolean;
}> {
  const qs = cursor ? `?cursor=${cursor}` : "";
  return apiGet(`/api/events/public${qs}`);
}

// ── Ratings / ELO ─────────────────────────────────────────────────────────────

export function fetchRatings(
  eventId: string,
  cursor?: string,
): Promise<{ data: PlayerRating[]; nextCursor: string | null; hasMore: boolean }> {
  const qs = cursor ? `?cursor=${cursor}&limit=50` : "?limit=50";
  return apiGet(`/api/events/${eventId}/ratings${qs}`);
}

// ── Payments ──────────────────────────────────────────────────────────────────

export function fetchPayments(eventId: string): Promise<PaymentsResponse> {
  return apiGet(`/api/events/${eventId}/payments`);
}

export function updatePaymentStatus(
  eventId: string,
  playerName: string,
  status: "paid" | "pending",
): Promise<{ ok: boolean }> {
  return apiFetch(`/api/events/${eventId}/payments`, {
    method: "PUT",
    body: JSON.stringify({ playerName, status }),
  }).then((r) => r.json());
}

// ── Post-game status ──────────────────────────────────────────────────────────

export function fetchPostGameStatus(eventId: string): Promise<PostGameStatus> {
  return apiGet(`/api/events/${eventId}/post-game-status`);
}

// ── Password / access ─────────────────────────────────────────────────────────

export function verifyEventPassword(
  eventId: string,
  password: string,
): Promise<{ ok: boolean }> {
  return apiPost(`/api/events/${eventId}/access/verify`, { password });
}

// ── Notification preferences ──────────────────────────────────────────────────

export function fetchNotificationPrefs(): Promise<NotificationPrefs> {
  return apiGet("/api/me/notification-preferences");
}

export function updateNotificationPrefs(
  prefs: Partial<NotificationPrefs>,
): Promise<NotificationPrefs> {
  return apiFetch("/api/me/notification-preferences", {
    method: "PUT",
    body: JSON.stringify(prefs),
  }).then((r) => r.json());
}

// ── Event log ─────────────────────────────────────────────────────────────────

export function fetchEventLog(
  eventId: string,
  cursor?: string,
): Promise<{ data: EventLogEntry[]; nextCursor: string | null; hasMore: boolean }> {
  const qs = cursor ? `?cursor=${cursor}` : "";
  return apiGet(`/api/events/${eventId}/log${qs}`);
}

// ── User profiles ─────────────────────────────────────────────────────────────

export function fetchUserProfile(userId: string): Promise<UserPublicProfile> {
  return apiGet(`/api/users/${userId}`);
}

export function fetchUserStats(userId: string): Promise<PlayerStats> {
  return apiGet(`/api/users/${userId}/stats`);
}

// ── Attendance ────────────────────────────────────────────────────────────────

export function fetchAttendance(eventId: string): Promise<AttendanceResult> {
  return apiGet(`/api/events/${eventId}/attendance`);
}
