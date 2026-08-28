package dev.convocados.data.repository

import dev.convocados.data.api.ConvocadosApi
import dev.convocados.data.api.EventSummary
import dev.convocados.data.api.EventDetail
import dev.convocados.data.api.GameHistory
import dev.convocados.data.api.SetScore
import dev.convocados.data.api.OkResponse
import dev.convocados.data.api.PaginatedHistory
import dev.convocados.data.api.Player
import dev.convocados.data.api.RemovePlayerResponse
import dev.convocados.data.api.RosterPlayer
import dev.convocados.data.api.TeamResult
import dev.convocados.data.api.UndoData
import dev.convocados.data.local.dao.EventDao
import dev.convocados.data.local.dao.EventDetailDao
import dev.convocados.data.local.dao.RecentlyViewedDao
import dev.convocados.data.local.entity.RecentlyViewedEventEntity
import dev.convocados.data.local.entity.EventDetailEntity
import dev.convocados.data.local.entity.GameHistoryEntity
import dev.convocados.data.local.entity.PlayerEntity
import dev.convocados.data.local.entity.toEntity
import dev.convocados.data.local.entity.toSummary
import dev.convocados.data.local.entity.EntityJson
import kotlinx.serialization.decodeFromString
import dev.convocados.data.api.MyGamesResponse
import dev.convocados.ui.UiEventManager
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

/** Domain model for the Games screen "Recently viewed" section. */
data class RecentlyViewedEvent(
    val eventId: String,
    val title: String,
    val location: String,
    val dateTime: String,
    val sport: String,
    val viewedAt: Long,
)

@Singleton
class EventRepository @Inject constructor(
    private val api: ConvocadosApi,
    private val eventDao: EventDao,
    private val eventDetailDao: EventDetailDao,
    private val recentlyViewedDao: RecentlyViewedDao,
    private val uiEventManager: UiEventManager
) {
    /** Record an event view (dedup by id, most-recent-first, capped at 10). */
    suspend fun recordEventView(eventId: String, title: String, location: String, dateTime: String, sport: String) {
        if (eventId == "demo") return // prototype demo event — never record
        recentlyViewedDao.upsert(
            RecentlyViewedEventEntity(
                eventId = eventId, title = title, location = location,
                dateTime = dateTime, sport = sport, viewedAt = System.currentTimeMillis(),
            )
        )
        recentlyViewedDao.prune(keep = 10)
    }

    fun recentlyViewed(): Flow<List<RecentlyViewedEvent>> =
        recentlyViewedDao.recent().map { entities ->
            entities.map {
                RecentlyViewedEvent(it.eventId, it.title, it.location, it.dateTime, it.sport, it.viewedAt)
            }
        }
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
        combine(eventDetailDao.getEvent(eventId), eventDetailDao.getHistory(eventId)) { event, history ->
            history.map { it.toDomain(event?.sport) }
        }

    /**
     * Fetch the latest event detail into the local cache.
     *
     * Returns true when fresh data was persisted, false when the network call
     * failed (timeout, no connection, server error). Never throws — callers
     * decide how to degrade: keep showing cached data (stale) or surface an
     * error page when nothing was ever cached.
     */
    suspend fun refreshEventDetail(eventId: String): Boolean {
        return try {
            val event = api.fetchEvent(eventId)
            val history = runCatching { api.fetchHistory(eventId) }.getOrElse { PaginatedHistory() }

            eventDetailDao.refreshEvent(
                event.toEntity(),
                event.players.map { it.toEntity(eventId) },
                history.data.map { it.toEntity(eventId) }
            )
            // Every successful fetch counts as a "view" — link visits included.
            recordEventView(event.id, event.title, event.location, event.dateTime, event.sport)
            true
        } catch (e: Exception) {
            false
        }
    }

    suspend fun refreshMyGames() {
        try {
            val response = api.fetchMyGames()
            eventDao.refreshEvents("owned", response.owned.map { it.toEntity("owned") })
            eventDao.refreshEvents("admin", response.admin.map { it.toEntity("admin") })
            eventDao.refreshEvents("followed", response.followed.map { it.toEntity("followed") })
            eventDao.refreshEvents("archivedOwned", response.archivedOwned.map { it.toEntity("archivedOwned") })
        } catch (e: Exception) {
            uiEventManager.showSnackbar("Failed to refresh games: ${e.message}")
        }
    }

    suspend fun addPlayer(
        eventId: String,
        name: String,
        link: Boolean,
        email: String? = null,
        idempotencyKey: String? = null,
    ): Result<String?> = try {
        val response = api.addPlayer(eventId, name, link, email, idempotencyKey)
        refreshEventDetail(eventId)
        Result.success(response.resolvedName)
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

    suspend fun archiveEvent(eventId: String): Result<Unit> = try {
        api.archiveEvent(eventId)
        refreshMyGames()
        Result.success(Unit)
    } catch (e: Exception) {
        Result.failure(e)
    }

    suspend fun unarchiveEvent(eventId: String): Result<Unit> = try {
        api.unarchiveEvent(eventId)
        refreshMyGames()
        Result.success(Unit)
    } catch (e: Exception) {
        Result.failure(e)
    }

    // Helper mappers for the Flow
    private fun EventDetailEntity.toDomain(players: List<PlayerEntity>, history: List<GameHistoryEntity>) = EventDetail(
        id = id, title = title, location = location, dateTime = dateTime,
        maxPlayers = maxPlayers, sport = sport, ownerId = ownerId,
        isAdmin = isAdmin, locked = locked, teamOneName = teamOneName, teamTwoName = teamTwoName,
        players = players.map { it.toDomain() },
        teamResults = teamResultsJson?.let {
            runCatching { EntityJson.decodeFromString<List<TeamResult>>(it) }.getOrNull()
        },
        invited = invitedJson?.let {
            runCatching { EntityJson.decodeFromString<List<RosterPlayer>>(it) }.getOrNull()
        } ?: emptyList(),
        declined = declinedJson?.let {
            runCatching { EntityJson.decodeFromString<List<RosterPlayer>>(it) }.getOrNull()
        } ?: emptyList(),
    )

    private fun PlayerEntity.toDomain() = Player(
        id = id, name = name, order = order, userId = userId, image = image
    )

    private fun GameHistoryEntity.toDomain(sport: String?) = GameHistory(
        id = id, dateTime = dateTime, scoreOne = scoreOne, scoreTwo = scoreTwo,
        scoreSets = scoreSetsJson?.let { runCatching { EntityJson.decodeFromString<List<SetScore>>(it) }.getOrNull() },
        scoringType = if (sport?.lowercase() in setOf("tennis", "tennis-singles", "tennis-doubles", "padel")) "tennis" else "standard",
        teamOneName = teamOneName, teamTwoName = teamTwoName
    )
}
