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
)

@Serializable
data class MyGamesResponse(
    val owned: List<EventSummary> = emptyList(),
    val joined: List<EventSummary> = emptyList(),
)

@Serializable
data class EventDetail(
    val id: String,
    val title: String,
    val location: String = "",
    val dateTime: String,
    val maxPlayers: Int,
    val teamOneName: String = "Team 1",
    val teamTwoName: String = "Team 2",
    val sport: String = "",
    val durationMinutes: Int = 60,
    val players: List<Player> = emptyList(),
    val teamResults: List<TeamResult>? = null,
)

@Serializable
data class Player(
    val id: String,
    val name: String,
    val order: Int,
    val userId: String? = null,
)

@Serializable
data class TeamResult(
    val id: String,
    val name: String,
    val members: List<TeamMember> = emptyList(),
)

@Serializable
data class TeamMember(
    val id: String,
    val name: String,
    val order: Int,
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
data class PostGameStatus(
    val gameEnded: Boolean = false,
    val hasScore: Boolean = false,
    val isParticipant: Boolean = false,
    val latestHistoryId: String? = null,
)

@Serializable
data class OkResponse(val ok: Boolean = true)

@Serializable
data class ScoreRequest(val scoreOne: Int, val scoreTwo: Int)

@Serializable
data class OAuthTokenResponse(
    @SerialName("access_token") val accessToken: String,
    @SerialName("refresh_token") val refreshToken: String? = null,
    @SerialName("expires_in") val expiresIn: Long,
)
