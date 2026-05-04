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
    val joined: List<EventSummary> = emptyList(),
    val archivedOwned: List<EventSummary> = emptyList(),
    val archivedJoined: List<EventSummary> = emptyList(),
    val ownedNextCursor: String? = null,
    val ownedHasMore: Boolean = false,
    val joinedNextCursor: String? = null,
    val joinedHasMore: Boolean = false,
)

@Serializable
data class GameHistory(
    val id: String,
    val dateTime: String,
    val status: String = "played",
    val scoreOne: Int? = null,
    val scoreTwo: Int? = null,
    val teamOneName: String = "",
    val teamTwoName: String = "",
    val editable: Boolean = false,
)

@Serializable
data class PaginatedHistory(
    val data: List<GameHistory> = emptyList(),
    val nextCursor: String? = null,
    val hasMore: Boolean = false,
)

@Serializable
data class ScoreRequest(val scoreOne: Int, val scoreTwo: Int)

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
