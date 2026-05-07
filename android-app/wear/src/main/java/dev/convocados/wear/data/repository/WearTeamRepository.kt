package dev.convocados.wear.data.repository

import android.util.Log
import dev.convocados.wear.data.api.TeamPlayer
import dev.convocados.wear.data.api.TeamsResponse
import dev.convocados.wear.data.api.UpdateTeamsRequest
import dev.convocados.wear.data.api.WearApiClient
import dev.convocados.wear.data.local.dao.PendingRosterChangeDao
import dev.convocados.wear.data.local.dao.WearPlayerDao
import dev.convocados.wear.data.local.entity.PendingRosterChangeEntity
import dev.convocados.wear.data.local.entity.WearPlayerEntity
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class WearTeamRepository @Inject constructor(
    private val client: WearApiClient,
    private val playerDao: WearPlayerDao,
    private val pendingRosterChangeDao: PendingRosterChangeDao,
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
                Log.w("WearTeamRepo", "Failed to sync roster change ${change.id}", e)
            }
        }
        pendingRosterChangeDao.deleteStale()
        return synced
    }

    private fun TeamPlayer.toEntity(eventId: String, assignment: String) = WearPlayerEntity(
        id = id,
        eventId = eventId,
        name = name,
        order = order,
        teamAssignment = assignment,
    )
}
