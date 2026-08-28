package dev.convocados.wear.data.api

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
    val isRecurring: Boolean = false,
    val archivedAt: String? = null,
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
data class SetScore(
    val teamOne: Int,
    val teamTwo: Int,
    val tiebreakTeamOne: Int? = null,
    val tiebreakTeamTwo: Int? = null,
)

@Serializable
data class GameHistory(
    val id: String,
    val dateTime: String,
    val status: String = "played",
    val scoreOne: Int? = null,
    val scoreTwo: Int? = null,
    val scoreSets: List<SetScore>? = null,
    val scoringType: String = "standard",
    val teamOneName: String = "",
    val teamTwoName: String = "",
    val teamsSnapshot: String? = null,
)

@Serializable
data class PaginatedHistory(
    val data: List<GameHistory> = emptyList(),
    val nextCursor: String? = null,
    val hasMore: Boolean = false,
)

@Serializable
data class ScoreRequest(val scoreOne: Int? = null, val scoreTwo: Int? = null, val scoreSets: List<SetScore>? = null)

@Serializable
data class ScalarScoreRequest(val scoreOne: Int, val scoreTwo: Int)

@Serializable
data class OAuthTokenResponse(
    @SerialName("access_token") val accessToken: String,
    @SerialName("refresh_token") val refreshToken: String? = null,
    @SerialName("expires_in") val expiresIn: Long,
)

@Serializable
data class TeamPlayer(
    val id: String,
    val name: String,
    val order: Int,
)

@Serializable
data class TeamInfo(
    val name: String,
    val players: List<TeamPlayer> = emptyList(),
)

@Serializable
data class TeamsResponse(
    val teamOne: TeamInfo,
    val teamTwo: TeamInfo,
    val unassigned: List<TeamPlayer> = emptyList(),
    val bench: List<TeamPlayer> = emptyList(),
    val maxPlayers: Int,
)

@Serializable
data class UpdateTeamsRequest(
    val teamOnePlayerIds: List<String>,
    val teamTwoPlayerIds: List<String>,
)

@Serializable
data class KnownPlayer(
    val name: String,
    val gamesPlayed: Int = 0,
    val userId: String? = null,
)

@Serializable
data class KnownPlayersResponse(
    val players: List<KnownPlayer> = emptyList(),
)

@Serializable
data class AddPlayerRequest(
    val name: String,
)

@Serializable
data class WatchGameResponse(
    val id: String,
    val created: Boolean = false,
)


@Serializable
data class MvpParticipant(
    @SerialName("id") val playerId: String,
    @SerialName("name") val playerName: String,
    val voteCount: Int = 0,
)

@Serializable
data class MvpWinner(
    val playerId: String,
    val playerName: String,
    val voteCount: Int,
)

@Serializable
data class MvpVoteRecord(
    val voterName: String,
    val votedForName: String,
)

@Serializable
data class MvpResponse(
    val mvp: List<MvpWinner>? = null,
    val votes: List<MvpVoteRecord> = emptyList(),
    val isVotingOpen: Boolean = false,
    val hasVoted: Boolean? = null,
    val totalVotes: Int = 0,
    val eligibleVoters: Int = 0,
    val participants: List<MvpParticipant> = emptyList(),
)

@Serializable
data class MvpVoteResult(
    val id: String,
    val votedForName: String,
)

@Serializable
data class MvpVoteResponse(
    val ok: Boolean,
    val vote: MvpVoteResult,
)
