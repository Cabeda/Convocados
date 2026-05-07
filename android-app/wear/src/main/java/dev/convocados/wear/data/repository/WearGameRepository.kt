package dev.convocados.wear.data.repository

import android.util.Log
import dev.convocados.wear.data.api.WearApiClient
import dev.convocados.wear.data.local.dao.WearGameDao
import dev.convocados.wear.data.local.dao.WearHistoryDao
import dev.convocados.wear.data.local.entity.WearGameEntity
import dev.convocados.wear.data.local.entity.WearHistoryEntity
import kotlinx.coroutines.flow.Flow
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class WearGameRepository @Inject constructor(
    private val client: WearApiClient,
    private val gameDao: WearGameDao,
    private val historyDao: WearHistoryDao,
) {
    /** Observable list of all cached games, sorted by dateTime. */
    fun observeGames(): Flow<List<WearGameEntity>> = gameDao.getAllGames()

    /** Observable list of archived games, most recent first. */
    fun observeArchivedGames(): Flow<List<WearGameEntity>> = gameDao.getArchivedGames()

    /** Observable latest history for a game. */
    fun observeLatestHistory(eventId: String): Flow<WearHistoryEntity?> =
        historyDao.observeLatestHistory(eventId)

    /** Refresh games from the API, falling back to cache on failure. */
    suspend fun refreshGames(): Result<Unit> = try {
        val response = client.get<dev.convocados.wear.data.api.MyGamesResponse>("/api/me/games")
        val owned = response.owned.map { it.toEntity("owned") }
        val joined = response.joined.map { it.toEntity("joined") }
        val archivedOwned = response.archivedOwned.map { it.toEntity("archived_owned") }
        val archivedJoined = response.archivedJoined.map { it.toEntity("archived_joined") }
        gameDao.refreshGames("owned", owned)
        gameDao.refreshGames("joined", joined)
        gameDao.refreshGames("archived_owned", archivedOwned)
        gameDao.refreshGames("archived_joined", archivedJoined)
        Result.success(Unit)
    } catch (e: Exception) {
        Log.w("WearGameRepo", "Failed to refresh games", e)
        Result.failure(e)
    }

    /** Refresh history for a specific event. */
    suspend fun refreshHistory(eventId: String): Result<Unit> = try {
        val history = client.get<dev.convocados.wear.data.api.PaginatedHistory>("/api/events/$eventId/history")
        historyDao.refreshHistory(
            eventId,
            history.data.map { it.toHistoryEntity(eventId) }
        )
        Result.success(Unit)
    } catch (e: Exception) {
        Log.w("WearGameRepo", "Failed to refresh history for $eventId", e)
        Result.failure(e)
    }

    /** Get the latest history entry for a game (from cache). */
    suspend fun getLatestHistory(eventId: String): WearHistoryEntity? =
        historyDao.getLatestHistory(eventId)

    /** Get a cached game by ID. */
    suspend fun getGame(eventId: String): WearGameEntity? = gameDao.getGame(eventId)

    // ── Mappers ──────────────────────────────────────────────────────────

    private fun dev.convocados.wear.data.api.EventSummary.toEntity(type: String) = WearGameEntity(
        id = id,
        title = title,
        location = location,
        dateTime = dateTime,
        sport = sport,
        maxPlayers = maxPlayers,
        playerCount = playerCount,
        teamOneName = "Team 1",
        teamTwoName = "Team 2",
        isRecurring = isRecurring,
        archivedAt = archivedAt,
        type = type,
    )

    private fun dev.convocados.wear.data.api.GameHistory.toHistoryEntity(eventId: String) =
        WearHistoryEntity(
            id = id,
            eventId = eventId,
            dateTime = dateTime,
            scoreOne = scoreOne,
            scoreTwo = scoreTwo,
            teamOneName = teamOneName,
            teamTwoName = teamTwoName,
            editable = editable,
        )
}
