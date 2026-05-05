package dev.convocados.wear.data.repository

import android.util.Log
import dev.convocados.wear.data.api.ScoreRequest
import dev.convocados.wear.data.api.TeamPlayer
import dev.convocados.wear.data.api.TeamsResponse
import dev.convocados.wear.data.api.UpdateTeamsRequest
import dev.convocados.wear.data.api.WearApiClient
import dev.convocados.wear.data.local.dao.PendingRosterChangeDao
import dev.convocados.wear.data.local.dao.PendingScoreDao
import dev.convocados.wear.data.local.dao.WearGameDao
import dev.convocados.wear.data.local.dao.WearHistoryDao
import dev.convocados.wear.data.local.dao.WearPlayerDao
import dev.convocados.wear.data.local.entity.PendingRosterChangeEntity
import dev.convocados.wear.data.local.entity.PendingScoreEntity
import dev.convocados.wear.data.local.entity.WearGameEntity
import dev.convocados.wear.data.local.entity.WearHistoryEntity
import dev.convocados.wear.data.local.entity.WearPlayerEntity
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class WearGameRepository @Inject constructor(
    private val client: WearApiClient,
    private val gameDao: WearGameDao,
    private val historyDao: WearHistoryDao,
    private val pendingScoreDao: PendingScoreDao,
    private val playerDao: WearPlayerDao,
    private val pendingRosterChangeDao: PendingRosterChangeDao,
) {
    /** Observable list of all cached games, sorted by dateTime. */
    fun observeGames(): Flow<List<WearGameEntity>> = gameDao.getAllGames()

    /** Observable list of archived games, most recent first. */
    fun observeArchivedGames(): Flow<List<WearGameEntity>> = gameDao.getArchivedGames()

    /** Observable latest history for a game. */
    fun observeLatestHistory(eventId: String): Flow<WearHistoryEntity?> =
        historyDao.observeLatestHistory(eventId)

    /** Observable count of pending (unsynced) scores. */
    fun observePendingCount(): Flow<Int> = pendingScoreDao.observeCount()

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

    /**
     * Submit a score. Tries the API first; if offline, queues it locally.
     * Updates the local cache optimistically either way.
     */
    suspend fun submitScore(
        eventId: String,
        historyId: String,
        scoreOne: Int,
        scoreTwo: Int,
        teamOneName: String,
        teamTwoName: String,
    ): Result<Unit> {
        // Optimistically update local cache
        historyDao.updateScore(historyId, scoreOne, scoreTwo)

        return try {
            client.patch<dev.convocados.wear.data.api.GameHistory>(
                "/api/events/$eventId/history/$historyId",
                ScoreRequest(scoreOne, scoreTwo),
            )
            Result.success(Unit)
        } catch (e: Exception) {
            Log.w("WearGameRepo", "Score submit failed, queuing for sync", e)
            pendingScoreDao.insert(
                PendingScoreEntity(
                    eventId = eventId,
                    historyId = historyId,
                    scoreOne = scoreOne,
                    scoreTwo = scoreTwo,
                    teamOneName = teamOneName,
                    teamTwoName = teamTwoName,
                )
            )
            Result.failure(e) // Queued for later — let UI know it's offline
        }
    }

    /** Sync all pending scores. Returns number of successfully synced items. */
    suspend fun syncPendingScores(): Int {
        val pending = pendingScoreDao.getAll()
        var synced = 0
        for (score in pending) {
            try {
                client.patch<dev.convocados.wear.data.api.GameHistory>(
                    "/api/events/${score.eventId}/history/${score.historyId}",
                    ScoreRequest(score.scoreOne, score.scoreTwo),
                )
                pendingScoreDao.delete(score)
                synced++
            } catch (e: Exception) {
                pendingScoreDao.incrementRetry(score.id)
                Log.w("WearGameRepo", "Failed to sync score ${score.id}", e)
            }
        }
        pendingScoreDao.deleteStale()
        return synced
    }

    // ── Teams ──────────────────────────────────────────────────────────────

    /** Observable players for an event. */
    fun observePlayers(eventId: String): Flow<List<WearPlayerEntity>> =
        playerDao.observePlayers(eventId)

    /** Refresh teams from the API and cache locally. */
    suspend fun refreshTeams(eventId: String): Result<TeamsResponse> = try {
        val response = client.getTeams(eventId)
        val players = mutableListOf<WearPlayerEntity>()
        response.teamOne.players.forEach { players.add(it.toEntity(eventId, "teamOne")) }
        response.teamTwo.players.forEach { players.add(it.toEntity(eventId, "teamTwo")) }
        response.unassigned.forEach { players.add(it.toEntity(eventId, "unassigned")) }
        response.bench.forEach { players.add(it.toEntity(eventId, "bench")) }
        playerDao.refreshPlayers(eventId, players)
        Result.success(response)
    } catch (e: Exception) {
        Log.w("WearGameRepo", "Failed to refresh teams for $eventId", e)
        Result.failure(e)
    }

    /**
     * Update team assignments. Tries the API first; if offline, queues locally.
     * Updates local cache optimistically.
     */
    suspend fun updateTeams(
        eventId: String,
        teamOnePlayerIds: List<String>,
        teamTwoPlayerIds: List<String>,
    ): Result<Unit> {
        // Optimistically update local cache
        val currentPlayerSnapshot = playerDao.observePlayers(eventId).first()
        val updatedPlayers = currentPlayerSnapshot.map { player ->
            when {
                teamOnePlayerIds.contains(player.id) -> player.copy(teamAssignment = "teamOne")
                teamTwoPlayerIds.contains(player.id) -> player.copy(teamAssignment = "teamTwo")
                player.teamAssignment == "teamOne" || player.teamAssignment == "teamTwo" ->
                    player.copy(teamAssignment = "unassigned")
                else -> player
            }
        }
        playerDao.refreshPlayers(eventId, updatedPlayers)

        return try {
            client.updateTeams(eventId, UpdateTeamsRequest(teamOnePlayerIds, teamTwoPlayerIds))
            // Re-fetch from server to get authoritative state
            refreshTeams(eventId)
            Result.success(Unit)
        } catch (e: Exception) {
            Log.w("WearGameRepo", "Team update failed, queuing for sync", e)
            val json = kotlinx.serialization.json.Json
            pendingRosterChangeDao.insert(
                PendingRosterChangeEntity(
                    eventId = eventId,
                    teamOnePlayerIds = json.encodeToString(ListSerializer(String.serializer()), teamOnePlayerIds),
                    teamTwoPlayerIds = json.encodeToString(ListSerializer(String.serializer()), teamTwoPlayerIds),
                )
            )
            Result.failure(e)
        }
    }

    /** Sync all pending roster changes. Returns number of successfully synced items. */
    suspend fun syncPendingRosterChanges(): Int {
        val pending = pendingRosterChangeDao.getAll()
        val json = kotlinx.serialization.json.Json
        var synced = 0
        for (change in pending) {
            try {
                val teamOneIds = json.decodeFromString<List<String>>(change.teamOnePlayerIds)
                val teamTwoIds = json.decodeFromString<List<String>>(change.teamTwoPlayerIds)
                client.updateTeams(change.eventId, UpdateTeamsRequest(teamOneIds, teamTwoIds))
                pendingRosterChangeDao.delete(change)
                synced++
            } catch (e: Exception) {
                pendingRosterChangeDao.incrementRetry(change.id)
                Log.w("WearGameRepo", "Failed to sync roster change ${change.id}", e)
            }
        }
        pendingRosterChangeDao.deleteStale()
        return synced
    }

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

    private fun TeamPlayer.toEntity(eventId: String, assignment: String) = WearPlayerEntity(
        id = id,
        eventId = eventId,
        name = name,
        order = order,
        teamAssignment = assignment,
    )
}
