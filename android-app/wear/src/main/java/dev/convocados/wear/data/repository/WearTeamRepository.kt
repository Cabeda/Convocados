package dev.convocados.wear.data.repository

import android.util.Log
import dev.convocados.wear.data.api.AddPlayerRequest
import dev.convocados.wear.data.api.TeamPlayer
import dev.convocados.wear.data.api.TeamsResponse
import dev.convocados.wear.data.api.UpdateTeamsRequest
import dev.convocados.wear.data.api.WearApiClient
import dev.convocados.wear.data.api.isTransientOfflineFailure
import dev.convocados.wear.data.local.dao.PendingActionDao
import dev.convocados.wear.data.local.dao.PendingRosterChangeDao
import dev.convocados.wear.data.local.dao.WearGameDao
import dev.convocados.wear.data.local.dao.WearPlayerDao
import dev.convocados.wear.data.local.entity.PendingActionEntity
import dev.convocados.wear.data.local.entity.PendingRosterChangeEntity
import dev.convocados.wear.data.local.entity.WearPlayerEntity
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/** Whether an add reached the server now or was queued for reconnect. */
enum class AddPlayerOutcome { ADDED, QUEUED }

@Singleton
class WearTeamRepository @Inject constructor(
    private val client: WearApiClient,
    private val playerDao: WearPlayerDao,
    private val gameDao: WearGameDao,
    private val pendingRosterChangeDao: PendingRosterChangeDao,
    private val pendingActionDao: PendingActionDao,
) {
    fun observePlayers(eventId: String): Flow<List<WearPlayerEntity>> =
        playerDao.observePlayers(eventId)

    suspend fun refreshTeams(eventId: String): Result<TeamsResponse> = try {
        val response = client.getTeams(eventId)
        val players = mutableListOf<WearPlayerEntity>()
        response.teamOne.players.forEach { players.add(it.toEntity(eventId, "teamOne")) }
        response.teamTwo.players.forEach { players.add(it.toEntity(eventId, "teamTwo")) }
        response.unassigned.forEach { players.add(it.toEntity(eventId, "unassigned")) }
        response.bench.forEach { players.add(it.toEntity(eventId, "bench")) }
        playerDao.refreshPlayers(eventId, players)
        // Persist the organizer's custom team names so the labels survive
        // offline and are reused across the Teams and Score screens.
        gameDao.updateTeamNames(
            eventId,
            response.teamOne.name.ifBlank { "Team 1" },
            response.teamTwo.name.ifBlank { "Team 2" },
        )
        Result.success(response)
    } catch (e: Exception) {
        Log.w("WearTeamRepo", "Failed to refresh teams for $eventId", e)
        Result.failure(e)
    }

    suspend fun updateTeams(
        eventId: String,
        teamOnePlayerIds: List<String>,
        teamTwoPlayerIds: List<String>,
    ): Result<Unit> {
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
            refreshTeams(eventId)
            Result.success(Unit)
        } catch (e: Exception) {
            Log.w("WearTeamRepo", "Team update failed, queuing for sync", e)
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

    /** Names added offline and still waiting to replay, for "Queued" feedback. */
    fun observePendingAddNames(eventId: String): Flow<List<String>> =
        pendingActionDao.observeAddNames(eventId)

    /**
     * Add a player to the event roster. Offline-first (#1343): a transient
     * failure queues the add with a stable idempotency key, so the reconnect
     * replay cannot create a duplicate. Permanent rejections surface.
     */
    suspend fun addPlayer(eventId: String, name: String): Result<AddPlayerOutcome> {
        val idempotencyKey = UUID.randomUUID().toString()
        return try {
            client.addPlayer(eventId, AddPlayerRequest(name), idempotencyKey)
            refreshTeams(eventId)
            Result.success(AddPlayerOutcome.ADDED)
        } catch (e: Exception) {
            if (e.isTransientOfflineFailure()) {
                pendingActionDao.insert(
                    PendingActionEntity(
                        kind = PendingActionEntity.KIND_ADD_PLAYER,
                        eventId = eventId,
                        playerName = name,
                        idempotencyKey = idempotencyKey,
                    ),
                )
                Log.w("WearTeamRepo", "Add player for $eventId queued offline", e)
                Result.success(AddPlayerOutcome.QUEUED)
            } else {
                Log.w("WearTeamRepo", "Failed to add player to $eventId", e)
                Result.failure(e)
            }
        }
    }

    /** Replay queued adds. Server wins on a 4xx: discard the action and re-fetch. */
    suspend fun syncPendingAddPlayers(): Int {
        var synced = 0
        // No retry cap: the add carries a stable idempotency key, so replay is
        // safe until a non-transient answer removes it.
        for (action in pendingActionDao.getByKind(PendingActionEntity.KIND_ADD_PLAYER)) {
            val name = action.playerName
            if (name == null) {
                pendingActionDao.deleteById(action.id)
                continue
            }
            try {
                client.addPlayer(action.eventId, AddPlayerRequest(name), action.idempotencyKey)
                pendingActionDao.deleteById(action.id)
                refreshTeams(action.eventId)
                synced++
            } catch (e: Exception) {
                if (e is dev.convocados.wear.data.api.ApiException && e.code == 401) {
                    // Session expired: keep the queued add for after sign-in.
                    pendingActionDao.incrementRetry(action.id)
                } else if (!e.isTransientOfflineFailure()) {
                    pendingActionDao.deleteById(action.id)
                    refreshTeams(action.eventId)
                } else {
                    pendingActionDao.incrementRetry(action.id)
                }
                Log.w("WearTeamRepo", "Add player replay failed for ${action.eventId}", e)
            }
        }
        return synced
    }

    suspend fun syncPendingRosterChanges(): Int {
        val pending = pendingRosterChangeDao.getAll()
        val json = kotlinx.serialization.json.Json
        var synced = 0
        for (change in pending) {
            if (change.retryCount >= MAX_ATTEMPTS) continue
            try {
                val teamOneIds = json.decodeFromString<List<String>>(change.teamOnePlayerIds)
                val teamTwoIds = json.decodeFromString<List<String>>(change.teamTwoPlayerIds)
                client.updateTeams(change.eventId, UpdateTeamsRequest(teamOneIds, teamTwoIds))
                pendingRosterChangeDao.delete(change)
                synced++
            } catch (e: Exception) {
                pendingRosterChangeDao.incrementRetry(change.id)
                Log.w("WearTeamRepo", "Failed to sync roster change ${change.id}", e)
            }
        }
        return synced
    }

    /** Discard stuck roster changes (user-initiated) — no silent drops. */
    suspend fun discardStuckRosterChanges() {
        pendingRosterChangeDao.getAll()
            .filter { it.retryCount >= MAX_ATTEMPTS }
            .forEach { pendingRosterChangeDao.deleteById(it.id) }
    }

    companion object {
        private const val MAX_ATTEMPTS = 8
    }

    private fun TeamPlayer.toEntity(eventId: String, assignment: String) = WearPlayerEntity(
        id = id,
        eventId = eventId,
        name = name,
        order = order,
        teamAssignment = assignment,
    )
}
