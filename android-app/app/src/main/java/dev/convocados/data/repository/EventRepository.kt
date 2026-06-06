package dev.convocados.data.repository

import dev.convocados.data.api.ConvocadosApi
import dev.convocados.data.api.EventSummary
import dev.convocados.data.api.EventDetail
import dev.convocados.data.api.GameHistory
import dev.convocados.data.api.OkResponse
import dev.convocados.data.api.PaginatedHistory
import dev.convocados.data.api.Player
import dev.convocados.data.api.RemovePlayerResponse
import dev.convocados.data.api.UndoData
import dev.convocados.data.local.dao.EventDao
import dev.convocados.data.local.dao.EventDetailDao
import dev.convocados.data.local.dao.PendingScoreDao
import dev.convocados.data.local.entity.EventDetailEntity
import dev.convocados.data.local.entity.GameHistoryEntity
import dev.convocados.data.local.entity.PendingScoreEntity
import dev.convocados.data.local.entity.PlayerEntity
import dev.convocados.data.local.entity.toEntity
import dev.convocados.data.local.entity.toSummary
import dev.convocados.data.api.MyGamesResponse
import dev.convocados.ui.UiEventManager
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class EventRepository @Inject constructor(
    private val api: ConvocadosApi,
    private val eventDao: EventDao,
    private val eventDetailDao: EventDetailDao,
    private val pendingScoreDao: PendingScoreDao,
    private val uiEventManager: UiEventManager
) {
    fun getEventsByType(type: String): Flow<List<EventSummary>> =
        eventDao.getEventsByType(type).map { entities ->
            entities.map { it.toSummary() }
        }

    fun getEventDetail(eventId: String): Flow<EventDetail?> =
        combine(
            eventDetailDao.getEvent(eventId),
            eventDetailDao.getPlayers(eventId),
            eventDetailDao.getHistory(eventId)
        ) { entity, players, history ->
            entity?.toDomain(players, history)
        }

    fun getPlayers(eventId: String): Flow<List<Player>> =
        eventDetailDao.getPlayers(eventId).map { entities -> entities.map { it.toDomain() } }

    fun getHistory(eventId: String): Flow<List<GameHistory>> =
        eventDetailDao.getHistory(eventId).map { entities -> entities.map { it.toDomain() } }

    suspend fun refreshEventDetail(eventId: String) {
        try {
            val event = api.fetchEvent(eventId)
            val history = runCatching { api.fetchHistory(eventId) }.getOrElse { PaginatedHistory() }
            
            eventDetailDao.refreshEvent(
                event.toEntity(),
                event.players.map { it.toEntity(eventId) },
                history.data.map { it.toEntity(eventId) }
            )
        } catch (e: Exception) {
            uiEventManager.showSnackbar("Offline: showing cached data")
        }
    }

    suspend fun refreshMyGames() {
        try {
            val response = api.fetchMyGames()
            eventDao.refreshEvents("owned", response.owned.map { it.toEntity("owned") })
            eventDao.refreshEvents("admin", response.admin.map { it.toEntity("admin") })
            eventDao.refreshEvents("followed", response.followed.map { it.toEntity("followed") })
        } catch (e: Exception) {
            uiEventManager.showSnackbar("Failed to refresh games: ${e.message}")
        }
    }

    suspend fun addPlayer(eventId: String, name: String, link: Boolean): Result<Unit> = try {
        api.addPlayer(eventId, name, link)
        refreshEventDetail(eventId)
        Result.success(Unit)
    } catch (e: Exception) {
        Result.failure(e)
    }

    suspend fun removePlayer(eventId: String, playerId: String): Result<UndoData?> = try {
        val res = api.removePlayer(eventId, playerId)
        refreshEventDetail(eventId)
        Result.success(res.undo)
    } catch (e: Exception) {
        Result.failure(e)
    }

    suspend fun verifyPassword(eventId: String, password: String): Result<Unit> = try {
        api.verifyEventPassword(eventId, password)
        refreshEventDetail(eventId)
        Result.success(Unit)
    } catch (e: Exception) {
        Result.failure(e)
    }

    fun observePendingScoreCount(): Flow<Int> = pendingScoreDao.observeCount()

    /**
     * Offline-first score save: updates local DB immediately (optimistic),
     * then tries API. On failure, queues for sync via WorkManager.
     * Returns Result.failure if queued offline (score is still saved locally).
     */
    suspend fun saveScore(eventId: String, historyId: String, scoreOne: Int, scoreTwo: Int): Result<Unit> {
        // Optimistic local update
        eventDetailDao.updateHistoryScore(historyId, scoreOne, scoreTwo)
        return try {
            api.updateScore(eventId, historyId, scoreOne, scoreTwo)
            Result.success(Unit)
        } catch (e: Exception) {
            pendingScoreDao.insert(
                PendingScoreEntity(
                    eventId = eventId,
                    historyId = historyId,
                    scoreOne = scoreOne,
                    scoreTwo = scoreTwo,
                )
            )
            Result.failure(e)
        }
    }

    // Helper mappers for the Flow
    private fun EventDetailEntity.toDomain(players: List<PlayerEntity>, history: List<GameHistoryEntity>) = EventDetail(
        id = id, title = title, location = location, dateTime = dateTime,
        maxPlayers = maxPlayers, sport = sport, ownerId = ownerId,
        isAdmin = isAdmin, locked = locked, teamOneName = teamOneName, teamTwoName = teamTwoName,
        players = players.map { it.toDomain() }
    )

    private fun PlayerEntity.toDomain() = Player(
        id = id, name = name, order = order, userId = userId
    )

    private fun GameHistoryEntity.toDomain() = GameHistory(
        id = id, dateTime = dateTime, scoreOne = scoreOne, scoreTwo = scoreTwo,
        teamOneName = teamOneName, teamTwoName = teamTwoName
    )
}
