package dev.convocados.wear.data.repository

import android.util.Log
import dev.convocados.wear.data.api.ApiException
import dev.convocados.wear.data.api.WearApiClient
import dev.convocados.wear.data.api.isRetryableLater
import dev.convocados.wear.data.local.dao.PendingActionDao
import dev.convocados.wear.data.local.dao.PendingScoreDao
import dev.convocados.wear.data.local.dao.WearGameDao
import dev.convocados.wear.data.local.dao.WearHistoryDao
import dev.convocados.wear.data.local.entity.PendingActionEntity
import dev.convocados.wear.data.local.entity.WearGameEntity
import dev.convocados.wear.data.local.entity.WearHistoryEntity
import dev.convocados.wear.data.repository.WearTeamRepository
import dev.convocados.wear.util.todayBoundsIso
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.joinAll
import kotlinx.coroutines.launch
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.time.Instant
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class WearGameRepository @Inject constructor(
    private val client: WearApiClient,
    private val gameDao: WearGameDao,
    private val historyDao: WearHistoryDao,
    private val teamRepository: WearTeamRepository,
    private val pendingScoreDao: PendingScoreDao,
    private val pendingActionDao: PendingActionDao,
) {
    /** Observable list of all cached games, sorted by dateTime. */
    fun observeGames(): Flow<List<WearGameEntity>> = gameDao.getAllGames()

    /** Observable list of archived games, most recent first. */
    fun observeArchivedGames(): Flow<List<WearGameEntity>> = gameDao.getArchivedGames()

    /** Observable latest history for a game. */
    fun observeLatestHistory(eventId: String): Flow<WearHistoryEntity?> {
        val (start, end) = todayBoundsIso()
        return historyDao.observeLatestTodayHistory(eventId, start, end)
    }

    /** Observable latest history for a game regardless of day. The score screen
     *  scopes by the game's own dateTime, not today. */
    fun observeLatestHistoryForEvent(eventId: String): Flow<WearHistoryEntity?> =
        historyDao.observeLatestHistoryForEvent(eventId)

    /** All cached history, most recent first (wrist history screen). */
    fun observeAllHistory(): Flow<List<WearHistoryEntity>> = historyDao.observeAllHistory()

    /** Cached game titles by id (to render history rows with event names). */
    suspend fun gameTitles(): Map<String, String> =
        gameDao.getAllGames().first().associate { it.id to it.title }

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
        // Pre-fetch teams for all active (non-archived) games in parallel —
        // on a low-end watch doing these serially on every open is the #1
        // source of startup jank.
        val activeIds = (owned + admin + followed).map { it.id }.distinct()
        coroutineScope {
            activeIds.map { id ->
                launch { runCatching { teamRepository.refreshTeams(id) } }
            }.joinAll()
        }
        Result.success(Unit)
    } catch (e: Exception) {
        Log.w("WearGameRepo", "Failed to refresh games", e)
        Result.failure(e)
    }

    /** Refresh history for a specific event, preserving optimistic queued score targets. */
    suspend fun refreshHistory(eventId: String): Result<Unit> = try {
        val history = client.get<dev.convocados.wear.data.api.PaginatedHistory>("/api/events/$eventId/history")
        val cached = historyDao.getByEvent(eventId)
        val pendingByHistory = pendingScoreDao.getAll()
            .filter { it.eventId == eventId }
            .associateBy { it.historyId }
        val remoteHistory = history.data.map { it.toHistoryEntity(eventId) }
        val remoteIds = remoteHistory.mapTo(mutableSetOf()) { it.id }
        // A locally-started game has no server row yet; keep its placeholder
        // across a refresh only while a start is still queued (#1343). Without
        // the guard a crash between seed and enqueue would strand it forever.
        val hasPendingStart =
            pendingActionDao.getByKindAndEvent(PendingActionEntity.KIND_START_GAME, eventId).isNotEmpty()
        val mergedHistory = (remoteHistory + cached.filter {
            it.id !in remoteIds && (it.id in pendingByHistory || (hasPendingStart && it.id.startsWith(LOCAL_START_PREFIX)))
        })
            .map { local ->
                pendingByHistory[local.id]?.let { pending ->
                    local.copy(
                        scoreOne = pending.scoreOne,
                        scoreTwo = pending.scoreTwo,
                        scoreSetsJson = pending.scoreSetsJson,
                        teamOneName = pending.teamOneName,
                        teamTwoName = pending.teamTwoName,
                    )
                } ?: local
            }
        historyDao.refreshHistory(eventId, mergedHistory)
        Result.success(Unit)
    } catch (e: Exception) {
        Log.w("WearGameRepo", "Failed to refresh history for $eventId", e)
        Result.failure(e)
    }

    /** Get the latest history entry for a game (from cache). */
    suspend fun getLatestHistory(eventId: String): WearHistoryEntity? =
        historyDao.getLatestHistory(eventId)

    /** Get the latest history entry whose dateTime is today (active game session). */
    suspend fun getLatestTodayHistory(eventId: String): WearHistoryEntity? {
        val (start, end) = todayBoundsIso()
        return historyDao.getLatestTodayHistory(eventId, start, end)
    }

    /**
     * Start score tracking for an event (creates today's history record if
     * teams are assigned), then refresh the local history cache.
     *
     * Offline-first (#1343): when the watch has no network, the start is
     * accepted locally — a placeholder history lets scoring continue — and the
     * create is queued for [syncPendingStarts]. A permanent rejection still
     * fails so the UI can explain it.
     */
    suspend fun startGame(eventId: String): Result<Unit> = try {
        client.startWatchGame(eventId)
        refreshHistory(eventId)
        Result.success(Unit)
    } catch (e: Exception) {
        if (e.isRetryableLater()) {
            // Queue before seeding: a crash in between must not leave a
            // placeholder that nothing will ever adopt. A local write failure
            // is reported, never thrown out of this graceful path.
            val queued = runCatching {
                enqueueStart(eventId)
                seedLocalHistory(eventId)
            }
            if (queued.isSuccess) {
                Log.w("WearGameRepo", "Start for $eventId queued offline", e)
                Result.success(Unit)
            } else {
                Log.e("WearGameRepo", "Failed to queue start for $eventId", queued.exceptionOrNull())
                Result.failure(e)
            }
        } else {
            Log.w("WearGameRepo", "Failed to start game $eventId", e)
            Result.failure(e)
        }
    }

    /**
     * Replay queued starts. The server create is idempotent per day, so a
     * replay is safe; the returned id replaces the local placeholder and any
     * scores queued against it. A business 4xx means the server has moved on
     * (server wins): discard the action and re-fetch.
     */
    suspend fun syncPendingStarts(): Int {
        var synced = 0
        // No retry cap: the create is idempotent and the placeholder must not be
        // abandoned locally; a non-transient answer removes the action below.
        for (action in pendingActionDao.getByKind(PendingActionEntity.KIND_START_GAME)) {
            try {
                val created = client.createWatchGameHistory(action.eventId)
                adoptServerHistory(action.eventId, created.id)
                pendingActionDao.deleteById(action.id)
                synced++
            } catch (e: ApiException) {
                if (e.isRetryableLater()) {
                    // Offline or a server hiccup: keep the local game and its
                    // scores. A rejected refresh is a SessionExpiredException,
                    // which the generic catch below also keeps — its 400 never
                    // lands here as a business answer and erases the night.
                    pendingActionDao.incrementRetry(action.id)
                } else {
                    // Server wins (404 gone, 403 no longer a member, 409): drop
                    // the local game and its scores, then re-fetch.
                    discardLocalStart(action.eventId)
                    pendingActionDao.deleteById(action.id)
                    refreshHistory(action.eventId)
                }
                Log.w("WearGameRepo", "Start replay rejected for ${action.eventId}", e)
            } catch (e: Exception) {
                pendingActionDao.incrementRetry(action.id)
                Log.w("WearGameRepo", "Start replay failed for ${action.eventId}", e)
            }
        }
        return synced
    }

    private suspend fun enqueueStart(eventId: String) {
        if (pendingActionDao.getByKindAndEvent(PendingActionEntity.KIND_START_GAME, eventId).isNotEmpty()) return
        pendingActionDao.insert(
            PendingActionEntity(
                kind = PendingActionEntity.KIND_START_GAME,
                eventId = eventId,
                idempotencyKey = UUID.randomUUID().toString(),
            ),
        )
    }

    private suspend fun seedLocalHistory(eventId: String) {
        val localId = LOCAL_START_PREFIX + eventId
        if (historyDao.getByEvent(eventId).any { it.id == localId }) return
        val game = gameDao.getGame(eventId)
        historyDao.insertAll(
            listOf(
                WearHistoryEntity(
                    id = localId,
                    eventId = eventId,
                    // Now sorts the placeholder ahead of older history; the game
                    // window bounds it, so it stays inside today.
                    dateTime = Instant.now().toString(),
                    scoreOne = 0,
                    scoreTwo = 0,
                    teamOneName = game?.teamOneName ?: "Team 1",
                    teamTwoName = game?.teamTwoName ?: "Team 2",
                    editable = true,
                ),
            ),
        )
    }

    private suspend fun adoptServerHistory(eventId: String, serverId: String) {
        historyDao.getByEvent(eventId)
            .filter { it.id.startsWith(LOCAL_START_PREFIX) }
            .forEach { local ->
                historyDao.insertAll(listOf(local.copy(id = serverId)))
                pendingScoreDao.rekeyHistory(local.id, serverId)
                historyDao.deleteById(local.id)
            }
        refreshHistory(eventId)
    }

    /** Server wins: the queued start will never apply, so its local game and scores go. */
    private suspend fun discardLocalStart(eventId: String) {
        historyDao.getByEvent(eventId)
            .filter { it.id.startsWith(LOCAL_START_PREFIX) }
            .forEach { local ->
                pendingScoreDao.deleteByHistory(eventId, local.id)
                historyDao.deleteById(local.id)
            }
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
        teamOneName = teamOneName.ifBlank { "Team 1" },
        teamTwoName = teamTwoName.ifBlank { "Team 2" },
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
            scoreSetsJson = scoreSets?.let { Json.encodeToString(it) },
            teamOneName = teamOneName,
            teamTwoName = teamTwoName,
            teamsSnapshot = teamsSnapshot,
            // The API no longer sends `editable`; the Room column is kept (inert)
            // because WearDatabase uses fallbackToDestructiveMigration, and dropping
            // the column would wipe offline-queued scores on upgrade.
            editable = true,
        )

    companion object {
        /** Prefix for a locally-started history that has no server id yet. */
        const val LOCAL_START_PREFIX = WearHistoryEntity.LOCAL_START_PREFIX
    }
}
