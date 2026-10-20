package dev.convocados.wear.data.repository

import dev.convocados.wear.data.api.ApiException
import dev.convocados.wear.data.api.SessionExpiredException
import dev.convocados.wear.data.api.TeamsResponse
import dev.convocados.wear.data.api.TeamInfo
import dev.convocados.wear.data.api.TeamPlayer
import dev.convocados.wear.data.api.WearApiClient
import dev.convocados.wear.data.local.dao.PendingActionDao
import dev.convocados.wear.data.local.dao.PendingRosterChangeDao
import dev.convocados.wear.data.local.dao.WearGameDao
import dev.convocados.wear.data.local.dao.WearPlayerDao
import dev.convocados.wear.data.local.entity.PendingActionEntity
import dev.convocados.wear.data.local.entity.WearPlayerEntity
import io.mockk.*
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.runTest
import java.io.IOException
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

class WearTeamRepositoryTest {

    private val client = mockk<WearApiClient>()
    private val playerDao = mockk<WearPlayerDao>(relaxed = true)
    private val gameDao = mockk<WearGameDao>(relaxed = true)
    private val pendingRosterChangeDao = mockk<PendingRosterChangeDao>(relaxed = true)
    private val pendingActionDao = mockk<PendingActionDao>(relaxed = true)

    private lateinit var repository: WearTeamRepository

    @Before
    fun setup() {
        repository = WearTeamRepository(client, playerDao, gameDao, pendingRosterChangeDao, pendingActionDao)
    }

    @Test
    fun `refreshTeams fetches and caches players`() = runTest {
        val response = TeamsResponse(
            teamOne = TeamInfo(name = "Team 1", players = listOf(TeamPlayer("p1", "Alice", 0))),
            teamTwo = TeamInfo(name = "Team 2", players = listOf(TeamPlayer("p2", "Bob", 0))),
            unassigned = listOf(TeamPlayer("p3", "Charlie", 0)),
            bench = emptyList(),
            maxPlayers = 10,
        )
        coEvery { client.getTeams("e1") } returns response

        val result = repository.refreshTeams("e1")

        assertTrue(result.isSuccess)
        coVerify { playerDao.refreshPlayers("e1", any()) }
    }

    @Test
    fun `refreshTeams caches the custom team names`() = runTest {
        val response = TeamsResponse(
            teamOne = TeamInfo(name = "Whites", players = emptyList()),
            teamTwo = TeamInfo(name = "Blues", players = emptyList()),
            unassigned = emptyList(),
            bench = emptyList(),
            maxPlayers = 10,
        )
        coEvery { client.getTeams("e1") } returns response

        repository.refreshTeams("e1")

        coVerify { gameDao.updateTeamNames("e1", "Whites", "Blues") }
    }

    @Test
    fun `refreshTeams returns failure on error`() = runTest {
        coEvery { client.getTeams("e1") } throws Exception("Network error")

        val result = repository.refreshTeams("e1")

        assertTrue(result.isFailure)
    }

    @Test
    fun `updateTeams updates local cache optimistically`() = runTest {
        val players = listOf(
            WearPlayerEntity("p1", "e1", "Alice", 0, "unassigned"),
            WearPlayerEntity("p2", "e1", "Bob", 0, "unassigned"),
        )
        coEvery { playerDao.observePlayers("e1") } returns flowOf(players)
        coEvery { client.updateTeams(any(), any()) } returns TeamsResponse(
            teamOne = TeamInfo(name = "Team 1", players = listOf(TeamPlayer("p1", "Alice", 0))),
            teamTwo = TeamInfo(name = "Team 2", players = listOf(TeamPlayer("p2", "Bob", 0))),
            unassigned = emptyList(),
            bench = emptyList(),
            maxPlayers = 10,
        )
        coEvery { client.getTeams("e1") } returns TeamsResponse(
            teamOne = TeamInfo(name = "Team 1", players = listOf(TeamPlayer("p1", "Alice", 0))),
            teamTwo = TeamInfo(name = "Team 2", players = listOf(TeamPlayer("p2", "Bob", 0))),
            unassigned = emptyList(),
            bench = emptyList(),
            maxPlayers = 10,
        )

        val result = repository.updateTeams("e1", listOf("p1"), listOf("p2"))

        assertTrue(result.isSuccess)
        coVerify { playerDao.refreshPlayers("e1", any()) }
    }

    @Test
    fun `updateTeams never sends a locally-added player id`() = runTest {
        val localId = WearPlayerEntity.LOCAL_PREFIX + "key"
        val players = listOf(
            WearPlayerEntity("p1", "e1", "Alice", 0, "unassigned"),
            WearPlayerEntity(localId, "e1", "Bob", Int.MAX_VALUE, "unassigned"),
        )
        coEvery { playerDao.observePlayers("e1") } returns flowOf(players)
        coEvery { client.updateTeams(any(), any()) } returns TeamsResponse(
            teamOne = TeamInfo(name = "Team 1", players = listOf(TeamPlayer("p1", "Alice", 0))),
            teamTwo = TeamInfo(name = "Team 2"),
            maxPlayers = 10,
        )
        coEvery { client.getTeams("e1") } returns TeamsResponse(
            teamOne = TeamInfo(name = "Team 1", players = listOf(TeamPlayer("p1", "Alice", 0))),
            teamTwo = TeamInfo(name = "Team 2"),
            maxPlayers = 10,
        )

        repository.updateTeams("e1", listOf("p1", localId), emptyList())

        coVerify {
            client.updateTeams(
                "e1",
                match { it.teamOnePlayerIds == listOf("p1") && it.teamTwoPlayerIds.isEmpty() },
            )
        }
    }

    @Test
    fun `updateTeams queues roster change on failure`() = runTest {
        val players = listOf(
            WearPlayerEntity("p1", "e1", "Alice", 0, "unassigned"),
        )
        coEvery { playerDao.observePlayers("e1") } returns flowOf(players)
        coEvery { client.updateTeams(any(), any()) } throws Exception("Offline")

        val result = repository.updateTeams("e1", listOf("p1"), emptyList())

        assertTrue(result.isFailure)
        coVerify { pendingRosterChangeDao.insert(any()) }
    }

    // --- #1343 offline queue: add player ---

    @Test
    fun `addPlayer posts with an idempotency key and refreshes teams`() = runTest {
        coEvery { client.addPlayer("e1", any(), any()) } just Runs
        coEvery { client.getTeams("e1") } returns TeamsResponse(
            teamOne = TeamInfo(name = "Team 1", players = listOf(TeamPlayer("p1", "Alice", 0))),
            teamTwo = TeamInfo(name = "Team 2"),
            maxPlayers = 10,
        )

        val result = repository.addPlayer("e1", "Alice")

        assertEquals(AddPlayerOutcome.ADDED, result.getOrNull())
        coVerify { client.addPlayer("e1", match { it.name == "Alice" }, match { it.isNotBlank() }) }
    }

    @Test
    fun `addPlayer queues a pending action when the network is unavailable`() = runTest {
        coEvery { client.addPlayer("e1", any(), any()) } throws IOException("Offline")

        val result = repository.addPlayer("e1", "Alice")

        assertEquals(AddPlayerOutcome.QUEUED, result.getOrNull())
        coVerify {
            pendingActionDao.insert(
                match {
                    it.kind == PendingActionEntity.KIND_ADD_PLAYER &&
                        it.eventId == "e1" &&
                        it.playerName == "Alice" &&
                        it.idempotencyKey.isNotBlank()
                },
            )
        }
        // The roster must show the add immediately, under a local id.
        coVerify {
            playerDao.insertAll(
                match { rows ->
                    rows.single().let {
                        it.name == "Alice" &&
                            it.eventId == "e1" &&
                            it.id.startsWith(WearPlayerEntity.LOCAL_PREFIX)
                    }
                },
            )
        }
    }

    @Test
    fun `addPlayer does not queue a permanent server rejection`() = runTest {
        coEvery { client.addPlayer("e1", any(), any()) } throws ApiException(403, "Game ended")

        val result = repository.addPlayer("e1", "Alice")

        assertTrue(result.isFailure)
        coVerify(exactly = 0) { pendingActionDao.insert(any()) }
    }

    @Test
    fun `observePendingAddNames delegates to the queue`() = runTest {
        coEvery { pendingActionDao.observeAddNames("e1") } returns flowOf(listOf("Alice"))

        assertEquals(listOf("Alice"), repository.observePendingAddNames("e1").first())
    }

    @Test
    fun `syncPendingAddPlayers replays with the stored idempotency key and deletes on success`() = runTest {
        val action = PendingActionEntity(
            id = 7L,
            kind = PendingActionEntity.KIND_ADD_PLAYER,
            eventId = "e1",
            playerName = "Alice",
            idempotencyKey = "stored-key",
        )
        coEvery { pendingActionDao.getByKind(PendingActionEntity.KIND_ADD_PLAYER) } returns listOf(action)
        coEvery { client.addPlayer(any(), any(), any()) } just Runs
        coEvery { client.getTeams("e1") } returns TeamsResponse(
            teamOne = TeamInfo(name = "Team 1"),
            teamTwo = TeamInfo(name = "Team 2"),
            maxPlayers = 10,
        )

        val synced = repository.syncPendingAddPlayers()

        assertEquals(1, synced)
        coVerify { client.addPlayer("e1", match { it.name == "Alice" }, "stored-key") }
        coVerify { pendingActionDao.deleteById(7L) }
    }

    @Test
    fun `an offline add keeps the team the organizer assigned before reconnect`() = runTest {
        val localId = WearPlayerEntity.LOCAL_PREFIX + "k1"
        val action = PendingActionEntity(
            id = 12L,
            kind = PendingActionEntity.KIND_ADD_PLAYER,
            eventId = "e1",
            playerName = "Alice",
            idempotencyKey = "k1",
        )
        val rosterAfterAdopt = listOf(
            WearPlayerEntity("p1", "e1", "Alice", 0, "unassigned"),
            WearPlayerEntity("p2", "e1", "Bob", 1, "unassigned"),
        )
        coEvery { pendingActionDao.getByKind(PendingActionEntity.KIND_ADD_PLAYER) } returns listOf(action)
        coEvery { playerDao.getById(localId) } returns WearPlayerEntity(
            localId, "e1", "Alice", Int.MAX_VALUE, "teamOne",
        )
        coEvery { playerDao.observePlayers("e1") } returns flowOf(rosterAfterAdopt)
        coEvery { client.addPlayer(any(), any(), any()) } just Runs
        coEvery { client.getTeams("e1") } returns TeamsResponse(
            teamOne = TeamInfo(name = "Team 1", players = listOf(TeamPlayer("p1", "Alice", 0))),
            teamTwo = TeamInfo(name = "Team 2"),
            unassigned = listOf(TeamPlayer("p2", "Bob", 1)),
            maxPlayers = 10,
        )
        coEvery { client.updateTeams(any(), any()) } returns TeamsResponse(
            teamOne = TeamInfo(name = "Team 1", players = listOf(TeamPlayer("p1", "Alice", 0))),
            teamTwo = TeamInfo(name = "Team 2"),
            unassigned = listOf(TeamPlayer("p2", "Bob", 1)),
            maxPlayers = 10,
        )

        assertEquals(1, repository.syncPendingAddPlayers())

        // The local echo is gone, and the adopted server player is back on team one.
        coVerify { playerDao.deleteById(localId) }
        coVerify { client.updateTeams("e1", match { it.teamOnePlayerIds == listOf("p1") && it.teamTwoPlayerIds.isEmpty() }) }
    }

    @Test
    fun `syncPendingAddPlayers discards the queued add and refetches when the server wins`() = runTest {
        var action = PendingActionEntity(
            id = 8L,
            kind = PendingActionEntity.KIND_ADD_PLAYER,
            eventId = "e1",
            playerName = "Alice",
            idempotencyKey = "stored-key",
        )
        // 409 (open-pickup conflict) and 403 (game ended) are reachable
        // business answers: the add cannot apply, so it is dropped.
        var id = 8L
        for (code in listOf(409, 403)) {
            action = action.copy(id = id)
            coEvery { pendingActionDao.getByKind(PendingActionEntity.KIND_ADD_PLAYER) } returns listOf(action)
            coEvery { client.addPlayer(any(), any(), any()) } throws ApiException(code, "rejected")
            coEvery { client.getTeams("e1") } returns TeamsResponse(
                teamOne = TeamInfo(name = "Team 1"),
                teamTwo = TeamInfo(name = "Team 2"),
                maxPlayers = 10,
            )

            val synced = repository.syncPendingAddPlayers()

            assertEquals(0, synced)
            coVerify { pendingActionDao.deleteById(id) }
            coVerify { client.getTeams("e1") }
            id++
        }
    }

    @Test
    fun `syncPendingAddPlayers keeps the queued add when the session expired`() = runTest {
        var id = 11L
        val errors = listOf<Exception>(
            ApiException(401, "unauthorized"),
            SessionExpiredException("Refresh rejected (400)"),
        )
        for (error in errors) {
            val action = PendingActionEntity(
                id = id,
                kind = PendingActionEntity.KIND_ADD_PLAYER,
                eventId = "e1",
                playerName = "Alice",
                idempotencyKey = "stored-key",
            )
            coEvery { pendingActionDao.getByKind(PendingActionEntity.KIND_ADD_PLAYER) } returns listOf(action)
            coEvery { client.addPlayer(any(), any(), any()) } throws error

            val synced = repository.syncPendingAddPlayers()

            assertEquals(0, synced)
            coVerify { pendingActionDao.incrementRetry(id) }
            coVerify(exactly = 0) { pendingActionDao.deleteById(id) }
            id++
        }
    }
}
