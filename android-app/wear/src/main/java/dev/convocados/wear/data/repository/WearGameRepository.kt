package dev.convocados.wear.data.repository

import android.util.Log
import dev.convocados.wear.data.api.WearApiClient
import dev.convocados.wear.data.local.dao.WearGameDao
import dev.convocados.wear.data.local.dao.WearHistoryDao
import dev.convocados.wear.data.local.entity.WearGameEntity
import dev.convocados.wear.data.local.entity.WearHistoryEntity
import dev.convocados.wear.data.repository.WearTeamRepository
import kotlinx.coroutines.flow.Flow
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class WearGameRepository @Inject constructor(
    private val client: WearApiClient,
    private val gameDao: WearGameDao,
    private val historyDao: WearHistoryDao,
    private val teamRepository: WearTeamRepository,
) {
    /** Observable list of all cached games, sorted by dateTime. */
    fun observeGames(): Flow<List<WearGameEntity>> = gameDao.getAllGames()

    /** Observable list of archived games, most recent first. */
    fun observeArchivedGames(): Flow<List<WearGameEntity>> = gameDao.getArchivedGames()

    /** Observable latest history for a game. */
    fun observeLatestHistory(eventId: String): Flow<WearHistoryEntity?> =
        historyDao.observeLatestHistory(eventId)

    /** Refresh games from the API, falling back to cache on failure. Also pre-fetches teams for active games. */
    suspend fun refreshGames(): Result<Unit> = try {
        val response = client.get<dev.convocados.wear.data.api.MyGamesResponse>("/api/me/games")
        val owned = response.owned.map { it.toEntity("owned") }
        val admin = response.admin.map { it.toEntity("admin") }
        val followed = response.followed.map { it.toEntity("followed") }
        val archivedOwned = response.archivedOwned.map { it.toEntity("archived_owned") }
        gameDao.refreshGames("owned", owned)
        gameDao.refreshGames("admin", admin)
        gameDao.refreshGames("followed", followed)
        gameDao.refreshGames("archived_owned", archivedOwned)
        // Pre-fetch teams for all active (non-archived) games
        val activeIds = (owned + admin + followed).map { it.id }
        for (id in activeIds) {
            try { teamRepository.refreshTeams(id) } catch (_: Exception) {}
        }
        Result.success(Unit)
    } catch (e: Exception) {
        Log.w("WearGameRepo", "Failed to refresh games", e)
        Result.failure(e)
    }

    /** Refresh history for a specific event. */
    suspend fun refreshHistory(eventId: String): Result<Unit> = try {        val history = client.get<dev.convocados.wear.data.api.PaginatedHistory>("/api/events/$eventId/history")
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

    /** Get the latest editable history entry (active game session). */
    suspend fun getLatestEditableHistory(eventId: String): WearHistoryEntity? =
        historyDao.getLatestEditableHistory(eventId)

    /**
     * Start score tracking for an event (creates today's history record if
     * teams are assigned), then refresh the local history cache.
     */
    suspend fun startGame(eventId: String): Result<Unit> = try {
        client.startWatchGame(eventId)
        refreshHistory(eventId)
        Result.success(Unit)
    } catch (e: Exception) {
        Log.w("WearGameRepo", "Failed to start game $eventId", e)
        Result.failure(e)
    }

    /** Get a cached game by ID. */
    suspend fun getGame(eventId: String): WearGameEntity? = gameDao.getGame(eventId)

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
            teamsSnapshot = teamsSnapshot,
            editable = editable,
        )
}
