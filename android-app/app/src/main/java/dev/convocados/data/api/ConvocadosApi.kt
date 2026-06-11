package dev.convocados.data.api

import kotlinx.serialization.Serializable
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class ConvocadosApi @Inject constructor(private val client: ApiClient) {

    // ── User ──────────────────────────────────────────────────────────────
    suspend fun fetchMyGames(): MyGamesResponse = client.get("/api/me/games")
    suspend fun fetchMyStats(): PlayerStats = client.get("/api/me/stats")
    suspend fun fetchUserInfo(): UserProfile = client.get("/api/me/profile")
    suspend fun fetchNotificationPrefs(): NotificationPrefs = client.get("/api/me/notification-preferences")
    suspend fun updateNotificationPrefs(prefs: Map<String, Boolean>): NotificationPrefs =
        client.put("/api/me/notification-preferences", prefs)

    // ── Events ────────────────────────────────────────────────────────────
    suspend fun createEvent(data: CreateEventRequest): CreateEventResponse =
        client.post("/api/events", data)

    suspend fun fetchEvent(id: String): EventDetail = client.get("/api/events/$id")

    suspend fun fetchHistory(id: String, cursor: String? = null): PaginatedHistory {
        val qs = if (cursor != null) "?cursor=$cursor" else ""
        return client.get("/api/events/$id/history$qs")
    }

    suspend fun fetchKnownPlayers(id: String): KnownPlayersResponse =
        client.get("/api/events/$id/known-players")

    suspend fun fetchPostGameStatus(id: String): PostGameStatus =
        client.get("/api/events/$id/post-game-status")

    // ── Players ───────────────────────────────────────────────────────────
    suspend fun addPlayer(eventId: String, name: String, linkToAccount: Boolean = true, email: String? = null): AddPlayerResponse =
        client.post("/api/events/$eventId/players", AddPlayerRequest(name, linkToAccount, email))

    suspend fun removePlayer(eventId: String, playerId: String): RemovePlayerResponse =
        client.delete("/api/events/$eventId/players", RemovePlayerRequest(playerId))

    suspend fun undoRemovePlayer(eventId: String, data: UndoData): OkResponse =
        client.post("/api/events/$eventId/undo-remove", data)

    suspend fun claimPlayer(eventId: String, playerId: String): OkResponse =
        client.post("/api/events/$eventId/claim-player", ClaimPlayerRequest(playerId))

    // ── Teams ─────────────────────────────────────────────────────────────
    suspend fun randomizeTeams(eventId: String, balanced: Boolean = false): OkResponse {
        val qs = if (balanced) "?balanced=true" else ""
        return client.post("/api/events/$eventId/randomize$qs")
    }

    suspend fun updateTeams(eventId: String, teamOnePlayerIds: List<String>, teamTwoPlayerIds: List<String>): OkResponse =
        client.patch("/api/events/$eventId/teams", UpdateTeamsRequest(teamOnePlayerIds, teamTwoPlayerIds))

    // ── Event editing ─────────────────────────────────────────────────────
    suspend fun updateTitle(eventId: String, title: String): OkResponse =
        client.put("/api/events/$eventId/title", TitleRequest(title))

    suspend fun updateLocation(eventId: String, location: String): OkResponse =
        client.put("/api/events/$eventId/location", LocationRequest(location))

    suspend fun updateDateTime(eventId: String, dateTime: String, timezone: String): OkResponse =
        client.put("/api/events/$eventId/datetime", DateTimeRequest(dateTime, timezone))

    suspend fun updateSport(eventId: String, sport: String): OkResponse =
        client.put("/api/events/$eventId/sport", SportRequest(sport))

    suspend fun updateMaxPlayers(eventId: String, maxPlayers: Int): OkResponse =
        client.put("/api/events/$eventId/max-players", MaxPlayersRequest(maxPlayers))

    suspend fun updateVisibility(eventId: String, isPublic: Boolean): OkResponse =
        client.put("/api/events/$eventId/visibility", VisibilityRequest(isPublic))

    suspend fun updateElo(eventId: String, enabled: Boolean): OkResponse =
        client.put("/api/events/$eventId/elo", EloRequest(enabled))

    suspend fun updateHideEloInTeams(eventId: String, hide: Boolean): OkResponse =
        client.put("/api/events/$eventId/hide-elo-in-teams", HideEloInTeamsRequest(hide))

    suspend fun updateSplitCosts(eventId: String, enabled: Boolean): OkResponse =
        client.put("/api/events/$eventId/split-costs", SplitCostsRequest(enabled))

    suspend fun updatePassword(eventId: String, password: String?): OkResponse =
        client.put("/api/events/$eventId/access", PasswordRequest(password))

    suspend fun archiveEvent(eventId: String): OkResponse =
        client.put("/api/events/$eventId/archive", ArchiveRequest(archive = true))

    suspend fun unarchiveEvent(eventId: String): OkResponse =
        client.put("/api/events/$eventId/archive", ArchiveRequest(archive = false))

    suspend fun verifyEventPassword(eventId: String, password: String): OkResponse =
        client.post("/api/events/$eventId/access/verify", PasswordVerifyRequest(password))

    // ── History / Score ───────────────────────────────────────────────────
    suspend fun updateScore(eventId: String, historyId: String, scoreOne: Int, scoreTwo: Int): GameHistory =
        client.patch("/api/events/$eventId/history/$historyId", ScoreRequest(scoreOne, scoreTwo))

    // ── Public events ─────────────────────────────────────────────────────
    suspend fun fetchPublicEvents(cursor: String? = null): PaginatedPublicEvents {
        val qs = if (cursor != null) "?cursor=$cursor" else ""
        return client.get("/api/events/public$qs")
    }

    // ── Ratings ───────────────────────────────────────────────────────────
    suspend fun fetchRatings(eventId: String, cursor: String? = null): PaginatedRatings {
        val qs = if (cursor != null) "?cursor=$cursor&limit=50" else "?limit=50"
        return client.get("/api/events/$eventId/ratings$qs")
    }

    // ── Payments ──────────────────────────────────────────────────────────
    suspend fun fetchPayments(eventId: String): PaymentsResponse =
        client.get("/api/events/$eventId/payments")

    suspend fun updatePaymentStatus(eventId: String, playerName: String, status: String): OkResponse =
        client.put("/api/events/$eventId/payments", PaymentUpdateRequest(playerName, status))

    /** Self-report: mark own payment as sent (pending → sent). */
    suspend fun markPaymentSent(eventId: String, playerName: String): OkResponse =
        client.put("/api/events/$eventId/payments", PaymentUpdateRequest(playerName, "sent"))

    /** Bulk mark all pending/sent as paid (owner/admin only). */
    suspend fun bulkMarkAllPaid(eventId: String): OkResponse =
        client.put("/api/events/$eventId/payments/bulk")

    // ── Balance / Payment Nudge ───────────────────────────────────────────
    suspend fun fetchBalance(eventId: String): BalanceResponse =
        client.get("/api/events/$eventId/balance")

    // ── Attendance ────────────────────────────────────────────────────────
    suspend fun fetchAttendance(eventId: String): AttendanceResult =
        client.get("/api/events/$eventId/attendance")

    // ── Event log ─────────────────────────────────────────────────────────
    suspend fun fetchEventLog(eventId: String, cursor: String? = null): PaginatedLog {
        val qs = if (cursor != null) "?cursor=$cursor" else ""
        return client.get("/api/events/$eventId/log$qs")
    }

    // ── User profiles ─────────────────────────────────────────────────────
    suspend fun fetchUserProfile(userId: String): UserProfileResponse =
        client.get("/api/users/$userId")

    suspend fun fetchUserStats(userId: String): PlayerStats =
        client.get("/api/users/$userId/stats")

    // ── Ownership ─────────────────────────────────────────────────────────
    suspend fun claimOwnership(eventId: String): OkResponse =
        client.post("/api/events/$eventId/claim")

    suspend fun relinquishOwnership(eventId: String): OkResponse =
        client.delete("/api/events/$eventId/claim")

    suspend fun transferOwnership(eventId: String, targetUserId: String): OkResponse =
        client.post("/api/events/$eventId/transfer", TransferRequest(targetUserId))

    // ── Profile ───────────────────────────────────────────────────────────
    suspend fun updateProfile(name: String): UserProfile =
        client.put("/api/me/profile", UpdateProfileRequest(name))

    // ── Reorder players ───────────────────────────────────────────────────
    suspend fun reorderPlayers(eventId: String, playerIds: List<String>): OkResponse =
        client.put("/api/events/$eventId/reorder-players", ReorderPlayersRequest(playerIds))

    // ── Ratings recalculate ───────────────────────────────────────────────
    suspend fun recalculateRatings(eventId: String): OkResponse =
        client.post("/api/events/$eventId/ratings/recalculate")

    // ── Cost override ─────────────────────────────────────────────────────
    suspend fun setCostOverride(eventId: String, playerName: String, amount: Double): OkResponse =
        client.put("/api/events/$eventId/cost/override", CostOverrideRequest(playerName, amount))

    // ── Location with coords ──────────────────────────────────────────────
    suspend fun updateLocationWithCoords(eventId: String, location: String, latitude: Double, longitude: Double): OkResponse =
        client.put("/api/events/$eventId/location", LocationWithCoordsRequest(location, latitude, longitude))

    // ── Share URL ─────────────────────────────────────────────────────────
    fun getShareUrl(eventId: String): String =
        "${client.getLoginUrl("").substringBefore("/api")}/events/$eventId"

    // ── MVP Voting ────────────────────────────────────────────────────────
    suspend fun castMvpVote(eventId: String, historyId: String, votedForPlayerId: String): MvpVoteResponse =
        client.post("/api/events/$eventId/history/$historyId/mvp-vote", MvpVoteRequest(votedForPlayerId))

    suspend fun fetchMvp(eventId: String, historyId: String): MvpResponse =
        client.get("/api/events/$eventId/history/$historyId/mvp")

    // ── Follow ────────────────────────────────────────────────────────────
    suspend fun getFollowState(eventId: String): FollowStateResponse =
        client.get("/api/events/$eventId/follow")

    suspend fun followEvent(eventId: String): FollowStateResponse =
        client.post("/api/events/$eventId/follow")

    suspend fun unfollowEvent(eventId: String): FollowStateResponse =
        client.delete("/api/events/$eventId/follow")

    suspend fun updateFollowPreferences(eventId: String, overrides: FollowOverridesRequest): FollowStateResponse =
        client.put("/api/events/$eventId/follow", overrides)

    // ── Court Finder ──────────────────────────────────────────────────────
    suspend fun fetchCourtAlternatives(
        eventId: String,
        radius: Int = 10000,
        startTime: String? = null,
        endTime: String? = null,
        includeBooked: Boolean = true,
    ): CourtAlternativesResponse {
        val params = buildString {
            append("?radius=$radius&includeBooked=$includeBooked")
            if (startTime != null) append("&startTime=$startTime")
            if (endTime != null) append("&endTime=$endTime")
        }
        return client.get("/api/events/$eventId/court-alternatives$params")
    }

    suspend fun fetchCourtWatches(): CourtWatchesResponse =
        client.get("/api/court-watches")

    suspend fun createCourtWatch(request: CreateCourtWatchRequest): OkResponse =
        client.post("/api/court-watches", request)

    suspend fun deleteCourtWatch(id: String): OkResponse =
        client.delete("/api/court-watches/$id")
}

// ── Request bodies ────────────────────────────────────────────────────────────

@Serializable
data class CreateEventRequest(
    val title: String,
    val location: String? = null,
    val dateTime: String,
    val timezone: String? = null,
    val maxPlayers: Int? = null,
    val sport: String? = null,
    val teamOneName: String? = null,
    val teamTwoName: String? = null,
    val isRecurring: Boolean = false,
    val recurrenceFreq: String? = null,
    val recurrenceInterval: Int? = null,
)

@Serializable data class AddPlayerRequest(val name: String, val linkToAccount: Boolean = true, val email: String? = null)
@Serializable data class RemovePlayerRequest(val playerId: String)
@Serializable data class ClaimPlayerRequest(val playerId: String)
@Serializable data class TitleRequest(val title: String)
@Serializable data class LocationRequest(val location: String)
@Serializable data class DateTimeRequest(val dateTime: String, val timezone: String)
@Serializable data class SportRequest(val sport: String)
@Serializable data class MaxPlayersRequest(val maxPlayers: Int)
@Serializable data class VisibilityRequest(val isPublic: Boolean)
@Serializable data class EloRequest(val eloEnabled: Boolean)
@Serializable data class HideEloInTeamsRequest(val hideEloInTeams: Boolean)
@Serializable data class SplitCostsRequest(val splitCostsEnabled: Boolean)
@Serializable data class PasswordRequest(val password: String?)
@Serializable data class PasswordVerifyRequest(val password: String)
@Serializable data class ScoreRequest(val scoreOne: Int, val scoreTwo: Int)
@Serializable data class PaymentUpdateRequest(val playerName: String, val status: String)
@Serializable data class UpdateTeamsRequest(val teamOnePlayerIds: List<String>, val teamTwoPlayerIds: List<String>)
@Serializable data class TransferRequest(val targetUserId: String)
@Serializable data class UpdateProfileRequest(val name: String)
@Serializable data class ReorderPlayersRequest(val playerIds: List<String>)
@Serializable data class CostOverrideRequest(val playerName: String, val amount: Double)
@Serializable data class LocationWithCoordsRequest(val location: String, val latitude: Double, val longitude: Double)

@Serializable
data class FollowOverridesRequest(
    val mutePlayerActivity: Boolean? = null,
    val muteReminders: Boolean? = null,
    val mutePostGame: Boolean? = null,
    val muteEventDetails: Boolean? = null,
)
