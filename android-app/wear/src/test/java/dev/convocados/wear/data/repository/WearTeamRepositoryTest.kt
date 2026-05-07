package dev.convocados.wear.data.repository

import dev.convocados.wear.data.api.TeamsResponse
import dev.convocados.wear.data.api.TeamInfo
import dev.convocados.wear.data.api.TeamPlayer
import dev.convocados.wear.data.api.WearApiClient
import dev.convocados.wear.data.local.dao.PendingRosterChangeDao
import dev.convocados.wear.data.local.dao.WearPlayerDao
import dev.convocados.wear.data.local.entity.WearPlayerEntity
import io.mockk.*
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

class WearTeamRepositoryTest {

    private val client = mockk<WearApiClient>()
    private val playerDao = mockk<WearPlayerDao>(relaxed = true)
    private val pendingRosterChangeDao = mockk<PendingRosterChangeDao>(relaxed = true)

    private lateinit var repository: WearTeamRepository

    @Before
    fun setup() {
        repository = WearTeamRepository(client, playerDao, pendingRosterChangeDao)
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
}
