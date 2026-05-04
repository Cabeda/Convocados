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
