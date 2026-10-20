package dev.convocados.wear.data.repository

import android.util.Log
import dev.convocados.wear.data.api.AddPlayerRequest
import dev.convocados.wear.data.api.TeamPlayer
import dev.convocados.wear.data.api.TeamsResponse
import dev.convocados.wear.data.api.UpdateTeamsRequest
import dev.convocados.wear.data.api.SessionExpiredException
import dev.convocados.wear.data.api.WearApiClient
import dev.convocados.wear.data.api.isRetryableLater
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
enum class AddPlayerOutcome { ADDED, QUEUED, QUEUED_SIGN_IN_REQUIRED }

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
        // A player added offline has a local id the server does not know yet;
        // send the server-known ids only, or the roster update 400s.
        val serverOneIds = teamOnePlayerIds.filterNot { it.startsWith(WearPlayerEntity.LOCAL_PREFIX) }
        val serverTwoIds = teamTwoPlayerIds.filterNot { it.startsWith(WearPlayerEntity.LOCAL_PREFIX) }
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
            client.updateTeams(eventId, UpdateTeamsRequest(serverOneIds, serverTwoIds))
            // This write carries the whole roster, so it supersedes every older
            // queued change for the event. Replaying one would undo it.
            pendingRosterChangeDao.deleteByEventId(eventId)
            refreshTeams(eventId)
            Result.success(Unit)
        } catch (e: Exception) {
            Log.w("WearTeamRepo", "Team update failed, queuing for sync", e)
            val json = kotlinx.serialization.json.Json
            pendingRosterChangeDao.insert(
                PendingRosterChangeEntity(
                    eventId = eventId,
                    teamOnePlayerIds = json.encodeToString(ListSerializer(String.serializer()), serverOneIds),
                    teamTwoPlayerIds = json.encodeToString(ListSerializer(String.serializer()), serverTwoIds),
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
            if (e.isRetryableLater()) {
                val queued = runCatching {
                    pendingActionDao.insert(
                        PendingActionEntity(
                            kind = PendingActionEntity.KIND_ADD_PLAYER,
                            eventId = eventId,
                            playerName = name,
                            idempotencyKey = idempotencyKey,
                        ),
                    )
                    // Echo the add on the roster the organizer actually reads,
                    // marked by its local id until the replay replaces it.
                    playerDao.insertAll(
                        listOf(
                            WearPlayerEntity(
                                id = WearPlayerEntity.LOCAL_PREFIX + idempotencyKey,
                                eventId = eventId,
                                name = name,
                                order = Int.MAX_VALUE,
                                teamAssignment = "unassigned",
                            ),
                        ),
                    )
                }
                if (queued.isSuccess) {
                    Log.w("WearTeamRepo", "Add player for $eventId queued offline", e)
                    Result.success(
                        if (e is SessionExpiredException) AddPlayerOutcome.QUEUED_SIGN_IN_REQUIRED
                        else AddPlayerOutcome.QUEUED,
                    )
                } else {
                    Log.e("WearTeamRepo", "Failed to queue add for $eventId", queued.exceptionOrNull())
                    Result.failure(e)
                }
            } else {
                Log.w("WearTeamRepo", "Failed to add player to $eventId", e)
                Result.failure(e)
            }
        }
    }

    /**
     * Replay queued adds. Server wins on a business 4xx: discard the action and
     * re-fetch. A team the organizer set on a local echo before reconnect is
     * re-applied once the server id exists (#1343).
     */
    suspend fun syncPendingAddPlayers(): Int {
        var synced = 0
        val adopted = mutableListOf<AdoptedAdd>()
        val touchedEvents = linkedSetOf<String>()
        // No retry cap: the add carries a stable idempotency key, so replay is
        // safe until a non-transient answer removes it.
        for (action in pendingActionDao.getByKind(PendingActionEntity.KIND_ADD_PLAYER)) {
            val name = action.playerName
            if (name == null) {
                pendingActionDao.deleteById(action.id)
                continue
            }
            val localId = WearPlayerEntity.LOCAL_PREFIX + action.idempotencyKey
            try {
                val local = playerDao.getById(localId)
                client.addPlayer(action.eventId, AddPlayerRequest(name), action.idempotencyKey)
                // The action stays queued until the roster refresh lands, so a
                // failure here replays (idempotently) instead of dropping the
                // assignment the organizer made offline.
                adopted += AdoptedAdd(action.id, action.eventId, name, localId, local?.teamAssignment)
                touchedEvents += action.eventId
                synced++
            } catch (e: Exception) {
                if (e.isRetryableLater()) {
                    // Offline, a server hiccup or an expired session: keep the
                    // add. A rejected refresh is typed, so it cannot be
                    // mistaken for the game-ending business 403.
                    pendingActionDao.incrementRetry(action.id)
                } else {
                    pendingActionDao.deleteById(action.id)
                    playerDao.deleteById(localId)
                    touchedEvents += action.eventId
                }
                Log.w("WearTeamRepo", "Add player replay failed for ${action.eventId}", e)
            }
        }
        // One refresh per event, after the loop: refreshing mid-replay would
        // re-read a roster that later iterations are still changing.
        val refreshed = touchedEvents.associateWith { refreshTeams(it).isSuccess }
        for (add in adopted) {
            if (refreshed[add.eventId] != true) {
                // No server ids to apply the assignment to yet; keep the add
                // queued and adopt it on the next run.
                pendingActionDao.incrementRetry(add.actionId)
                continue
            }
            pendingActionDao.deleteById(add.actionId)
            playerDao.deleteById(add.localId)
            reapplyTeamAssignment(add.eventId, add.name, add.teamAssignment)
        }
        return synced
    }

    /** Put a locally-added player back on the team chosen before the replay. */
    private suspend fun reapplyTeamAssignment(eventId: String, name: String, team: String?) {
        if (team != "teamOne" && team != "teamTwo") return
        val players = playerDao.observePlayers(eventId).first()
        // shortcut: same-named players are ambiguous; the first unassigned match
        // wins. Fine for a friend group, revisit if duplicate names get common.
        val adopted = players.firstOrNull { it.name == name && it.teamAssignment == "unassigned" } ?: return
        val oneIds = players.filter { it.teamAssignment == "teamOne" }.map { it.id }
        val twoIds = players.filter { it.teamAssignment == "teamTwo" }.map { it.id }
        updateTeams(
            eventId,
            if (team == "teamOne") oneIds + adopted.id else oneIds,
            if (team == "teamTwo") twoIds + adopted.id else twoIds,
        )
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

/** A queued add whose server create succeeded but whose roster is not adopted yet. */
private data class AdoptedAdd(
    val actionId: Long,
    val eventId: String,
    val name: String,
    val localId: String,
    val teamAssignment: String?,
)
