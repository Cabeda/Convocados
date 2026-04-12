package dev.convocados.wear.data.api

import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class WearApi @Inject constructor(private val client: WearApiClient) {

    suspend fun fetchMyGames(): MyGamesResponse = client.get("/api/me/games")

    suspend fun fetchEvent(id: String): EventDetail = client.get("/api/events/$id")

    suspend fun fetchHistory(id: String): PaginatedHistory =
        client.get("/api/events/$id/history")

    suspend fun fetchPostGameStatus(id: String): PostGameStatus =
        client.get("/api/events/$id/post-game-status")

    suspend fun updateScore(eventId: String, historyId: String, scoreOne: Int, scoreTwo: Int): GameHistory =
        client.patch("/api/events/$eventId/history/$historyId", ScoreRequest(scoreOne, scoreTwo))
}
