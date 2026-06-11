package dev.convocados.data.api

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class EventSummary(
    val id: String,
    val title: String,
    val location: String = "",
    val dateTime: String,
    val sport: String = "",
    val maxPlayers: Int,
    val playerCount: Int,
    val archivedAt: String? = null,
    val isRecurring: Boolean = false,
    val lastScoreOne: Int? = null,
    val lastScoreTwo: Int? = null,
)

@Serializable
data class MyGamesResponse(
    val owned: List<EventSummary> = emptyList(),
    val admin: List<EventSummary> = emptyList(),
    val followed: List<EventSummary> = emptyList(),
    val archivedOwned: List<EventSummary> = emptyList(),
    val ownedNextCursor: String? = null,
    val ownedHasMore: Boolean = false,
    val followedNextCursor: String? = null,
    val followedHasMore: Boolean = false,
)

@Serializable
data class Player(
    val id: String,
    val name: String,
    val order: Int,
    val userId: String? = null,
    val createdAt: String = "",
)

@Serializable
data class TeamMember(
    val id: String,
    val name: String,
    val order: Int,
)

@Serializable
data class TeamResult(
    val id: String,
    val name: String,
    val members: List<TeamMember> = emptyList(),
)

@Serializable
data class EventDetail(
    val id: String,
    val title: String,
    val location: String = "",
    val latitude: Double? = null,
    val longitude: Double? = null,
    val dateTime: String,
    val timezone: String = "",
    val maxPlayers: Int,
    val teamOneName: String = "Team 1",
    val teamTwoName: String = "Team 2",
    val sport: String = "",
    val durationMinutes: Int = 60,
    val isPublic: Boolean = false,
    val isRecurring: Boolean = false,
    val recurrenceRule: String? = null,
    val nextResetAt: String? = null,
    val ownerId: String? = null,
    val ownerName: String? = null,
    val isAdmin: Boolean = false,
    val hasPassword: Boolean = false,
    val eloEnabled: Boolean = false,
    val hideEloInTeams: Boolean = false,
    val splitCostsEnabled: Boolean = false,
    val mvpEnabled: Boolean = true,
    val balanced: Boolean = false,
    val archivedAt: String? = null,
    val createdAt: String = "",
    val updatedAt: String = "",
    val players: List<Player> = emptyList(),
    val teamResults: List<TeamResult>? = null,
    val wasReset: Boolean = false,
    val locked: Boolean = false,
)

@Serializable
data class EloUpdate(val name: String, val delta: Int)

@Serializable
data class GameHistory(
    val id: String,
    val dateTime: String,
    val status: String = "played",
    val scoreOne: Int? = null,
    val scoreTwo: Int? = null,
    val teamOneName: String = "",
    val teamTwoName: String = "",
    val teamsSnapshot: String? = null,
    val paymentsSnapshot: String? = null,
    val editableUntil: String = "",
    val createdAt: String = "",
    val editable: Boolean = false,
    val source: String = "live",
    val eloUpdates: List<EloUpdate>? = null,
)

@Serializable
data class PaginatedHistory(
    val data: List<GameHistory> = emptyList(),
    val nextCursor: String? = null,
    val hasMore: Boolean = false,
)

@Serializable
data class PlayerStats(
    val summary: StatsSummary,
    val events: List<EventStats> = emptyList(),
)

@Serializable
data class StatsSummary(
    val totalGames: Int = 0,
    val totalWins: Int = 0,
    val totalDraws: Int = 0,
    val totalLosses: Int = 0,
    val winRate: Double = 0.0,
    val avgRating: Int = 0,
    val bestRating: Int = 0,
    val eventsPlayed: Int = 0,
)

@Serializable
data class AttendanceInfo(
    val gamesPlayed: Int = 0,
    val totalGames: Int = 0,
    val attendanceRate: Double = 0.0,
    val currentStreak: Int = 0,
)

@Serializable
data class EventStats(
    val eventId: String,
    val eventTitle: String,
    val sport: String = "",
    val rating: Int = 1000,
    val gamesPlayed: Int = 0,
    val wins: Int = 0,
    val draws: Int = 0,
    val losses: Int = 0,
    val winRate: Double = 0.0,
    val attendance: AttendanceInfo? = null,
)

@Serializable
data class UserProfile(
    val id: String,
    val name: String,
    val email: String,
    val image: String? = null,
)

@Serializable
data class OAuthTokenResponse(
    @SerialName("access_token") val accessToken: String,
    @SerialName("refresh_token") val refreshToken: String? = null,
    @SerialName("expires_in") val expiresIn: Long,
)

@Serializable
data class PublicEvent(
    val id: String,
    val title: String,
    val location: String = "",
    val latitude: Double? = null,
    val longitude: Double? = null,
    val sport: String = "",
    val dateTime: String,
    val maxPlayers: Int,
    val playerCount: Int,
    val spotsLeft: Int,
)

@Serializable
data class PaginatedPublicEvents(
    val data: List<PublicEvent> = emptyList(),
    val nextCursor: String? = null,
    val hasMore: Boolean = false,
)

@Serializable
data class PlayerRating(
    val id: String,
    val name: String,
    val rating: Int,
    val initialRating: Int? = null,
    val gamesPlayed: Int = 0,
    val wins: Int = 0,
    val draws: Int = 0,
    val losses: Int = 0,
)

@Serializable
data class PaginatedRatings(
    val data: List<PlayerRating> = emptyList(),
    val nextCursor: String? = null,
    val hasMore: Boolean = false,
)

@Serializable
data class Payment(
    val id: String,
    val playerName: String,
    val amount: Double = 0.0,
    val status: String = "pending",
    val method: String? = null,
    val paidAt: String? = null,
    val createdAt: String = "",
    val updatedAt: String = "",
)

@Serializable
data class PaymentSummary(
    val paidCount: Int = 0,
    val pendingCount: Int = 0,
    val totalCount: Int = 0,
    val paidAmount: Double = 0.0,
)

@Serializable
data class PaymentsResponse(
    val payments: List<Payment> = emptyList(),
    val summary: PaymentSummary = PaymentSummary(),
    val currency: String? = null,
    val totalAmount: Double? = null,
)

@Serializable
data class PostGameStatus(
    val gameEnded: Boolean = false,
    val hasScore: Boolean = false,
    val hasCost: Boolean = false,
    val allPaid: Boolean = false,
    val allComplete: Boolean = false,
    val isParticipant: Boolean = false,
    val latestHistoryId: String? = null,
    val costCurrency: String? = null,
    val costAmount: Double? = null,
    val hasPendingPastPayments: Boolean = false,
)

@Serializable
data class NotificationPrefs(
    val emailEnabled: Boolean = true,
    val pushEnabled: Boolean = true,
    val gameInviteEmail: Boolean = true,
    val gameInvitePush: Boolean = true,
    val gameReminderEmail: Boolean = true,
    val gameReminderPush: Boolean = true,
    val playerActivityPush: Boolean = true,
    val eventDetailsPush: Boolean = true,
    val weeklySummaryEmail: Boolean = true,
    val paymentReminderEmail: Boolean = true,
    val paymentReminderPush: Boolean = true,
    val reminder24h: Boolean = true,
    val reminder2h: Boolean = true,
    val reminder1h: Boolean = true,
)

@Serializable
data class EventLogEntry(
    val id: String,
    val action: String,
    val actor: String? = null,
    val actorId: String? = null,
    val details: kotlinx.serialization.json.JsonElement? = null,
    val createdAt: String,
)

@Serializable
data class PaginatedLog(
    val entries: List<EventLogEntry> = emptyList(),
    val nextCursor: String? = null,
    val hasMore: Boolean = false,
)

@Serializable
data class AttendanceRecord(
    val name: String,
    val gamesPlayed: Int = 0,
    val totalGames: Int = 0,
    val attendanceRate: Double = 0.0,
    val currentStreak: Int = 0,
    val lastPlayed: String? = null,
)

@Serializable
data class AttendanceResult(
    val players: List<AttendanceRecord> = emptyList(),
    val totalGames: Int = 0,
)

@Serializable
data class KnownPlayer(
    val name: String,
    val gamesPlayed: Int = 0,
)

@Serializable
data class KnownPlayersResponse(
    val players: List<KnownPlayer> = emptyList(),
)

@Serializable
data class UserPublicProfile(
    val id: String,
    val name: String,
    val image: String? = null,
    val stats: PublicStats? = null,
)

@Serializable
data class UserProfileResponse(
    val user: UserPublicProfile,
    val stats: ProfileStats? = null,
    val owned: List<ProfileEvent> = emptyList(),
    val joined: List<ProfileEvent> = emptyList(),
)

@Serializable
data class ProfileStats(
    val totalGames: Int = 0,
    val ownedGames: Int = 0,
    val joinedGames: Int = 0,
)

@Serializable
data class ProfileEvent(
    val id: String,
    val title: String,
    val dateTime: String = "",
    val sport: String = "",
    val playerCount: Int = 0,
    val maxPlayers: Int = 10,
)

@Serializable
data class PublicStats(
    val totalGames: Int = 0,
    val totalWins: Int = 0,
    val totalDraws: Int = 0,
    val totalLosses: Int = 0,
    val winRate: Double = 0.0,
    val avgRating: Int = 0,
)

@Serializable
data class OkResponse(val ok: Boolean = true)

@Serializable
data class AddPlayerResponse(val ok: Boolean = true, val invited: String? = null, val resolvedName: String? = null)

@Serializable
data class ArchiveRequest(val archive: Boolean)

// ── MVP Voting ──────────────────────────────────────────────────────────────

@Serializable
data class MvpVoteRequest(val votedForPlayerId: String)

@Serializable
data class MvpVoteResponse(val ok: Boolean = true, val vote: MvpVoteDetail? = null)

@Serializable
data class MvpVoteDetail(val id: String, val votedForName: String)

@Serializable
data class MvpCandidate(val playerId: String, val playerName: String, val voteCount: Int)

@Serializable
data class MvpVoteSummary(val voterName: String, val votedForName: String)

@Serializable
data class MvpResponse(
    val mvp: List<MvpCandidate>? = null,
    val votes: List<MvpVoteSummary> = emptyList(),
    val isVotingOpen: Boolean = false,
    val hasVoted: Boolean? = null,
    val totalVotes: Int = 0,
)

@Serializable
data class CreateEventResponse(val id: String)

@Serializable
data class RemovePlayerResponse(
    val ok: Boolean = true,
    val undo: UndoData? = null,
)

@Serializable
data class UndoData(
    val name: String,
    val order: Int,
    val userId: String? = null,
    val removedAt: Long,
)

@Serializable
data class FollowStateResponse(
    val following: Boolean = false,
    val mutePlayerActivity: Boolean? = null,
    val muteReminders: Boolean? = null,
    val mutePostGame: Boolean? = null,
    val muteEventDetails: Boolean? = null,
)

// ── Court Finder ────────────────────────────────────────────────────────────

@Serializable
data class CourtAlternative(
    val tenantId: String,
    val tenantName: String,
    val resourceName: String,
    val slotTime: String,
    val price: Double,
    val currency: String = "EUR",
    val status: String = "available",
    val playtomicUrl: String = "",
    val distanceKm: Double = 0.0,
    val coordinate: CourtCoordinate? = null,
)

@Serializable
data class CourtCoordinate(val lat: Double, val lng: Double)

@Serializable
data class CourtAlternativesResponse(val alternatives: List<CourtAlternative> = emptyList())

@Serializable
data class CourtWatch(
    val id: String,
    val sport: String = "",
    val tenantId: String = "",
    val tenantName: String = "",
    val resourceId: String = "",
    val resourceName: String = "",
    val dayOfWeek: Int = 1,
    val startTime: String = "",
    val endTime: String = "",
    val timezone: String = "",
    val createdAt: String = "",
)

@Serializable
data class CourtWatchesResponse(val watches: List<CourtWatch> = emptyList())

@Serializable
data class CreateCourtWatchRequest(
    val sport: String,
    val tenantId: String,
    val tenantName: String,
    val resourceId: String,
    val resourceName: String,
    val dayOfWeek: Int,
    val startTime: String,
    val endTime: String,
    val timezone: String,
)

// ── Payment Nudge / Balance ─────────────────────────────────────────────────

@Serializable
data class PlayerBalance(
    val playerName: String = "",
    val amount: Double = 0.0,
    val gamesOwed: Int = 0,
    val streak: Int = 0,
)

@Serializable
data class BalanceAggregate(
    val paidCount: Int = 0,
    val totalCount: Int = 0,
)

@Serializable
data class BalanceResponse(
    val enforcement: String = "nudge",
    val threshold: Double = 0.0,
    val callerBalance: PlayerBalance? = null,
    val aggregate: BalanceAggregate = BalanceAggregate(),
    val balances: List<PlayerBalance> = emptyList(),
)

@Serializable
data class PaymentGateError(
    val error: String = "",
    val code: String = "",
    val balance: PlayerBalance? = null,
    val gateAmount: Double = 0.0,
    val enforcement: String = "",
    val threshold: Double = 0.0,
)