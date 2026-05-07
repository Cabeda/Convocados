package dev.convocados.wear.data.repository

import app.cash.turbine.test
import dev.convocados.wear.data.api.EventSummary
import dev.convocados.wear.data.api.GameHistory
import dev.convocados.wear.data.api.MyGamesResponse
import dev.convocados.wear.data.api.PaginatedHistory
import dev.convocados.wear.data.api.WearApiClient
import dev.convocados.wear.data.local.dao.WearGameDao
import dev.convocados.wear.data.local.dao.WearHistoryDao
import dev.convocados.wear.data.local.entity.WearGameEntity
import io.mockk.*
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

class WearGameRepositoryTest {

    private val client = mockk<WearApiClient>()
    private val gameDao = mockk<WearGameDao>(relaxed = true)
    private val historyDao = mockk<WearHistoryDao>(relaxed = true)

    private lateinit var repository: WearGameRepository

    @Before
    fun setup() {
        repository = WearGameRepository(client, gameDao, historyDao)
    }

    @Test
    fun `observeGames delegates to gameDao`() = runTest {
        val games = listOf(makeGame("1"), makeGame("2"))
        coEvery { gameDao.getAllGames() } returns flowOf(games)

        repository.observeGames().test {
            assertEquals(games, awaitItem())
            awaitComplete()
        }
    }

    @Test
    fun `refreshGames fetches from API and updates dao`() = runTest {
        val response = MyGamesResponse(
            owned = listOf(EventSummary("1", "Game 1", "Field A", "2025-01-01T10:00:00Z", "Soccer", 10, 5, false, null)),
            joined = listOf(EventSummary("2", "Game 2", "Field B", "2025-01-02T10:00:00Z", "Basketball", 8, 4, false, null)),
        )
        coEvery { client.get<MyGamesResponse>(any()) } returns response

        val result = repository.refreshGames()

        assertTrue(result.isSuccess)
        coVerify { gameDao.refreshGames("owned", any()) }
        coVerify { gameDao.refreshGames("joined", any()) }
    }

    @Test
    fun `refreshGames returns failure on network error`() = runTest {
        coEvery { client.get<MyGamesResponse>(any()) } throws Exception("Network error")

        val result = repository.refreshGames()

        assertTrue(result.isFailure)
        assertEquals("Network error", result.exceptionOrNull()?.message)
    }

    @Test
    fun `refreshHistory fetches and caches history`() = runTest {
        val history = PaginatedHistory(
            data = listOf(
                GameHistory("h1", "2025-01-01T10:00:00Z", "played", 3, 2, "Red", "Blue", true),
            ),
        )
        coEvery { client.get<PaginatedHistory>(any()) } returns history

        val result = repository.refreshHistory("event1")

        assertTrue(result.isSuccess)
        coVerify { historyDao.refreshHistory("event1", any()) }
    }

    @Test
    fun `refreshHistory returns failure on error`() = runTest {
        coEvery { client.get<PaginatedHistory>(any()) } throws Exception("Timeout")

        val result = repository.refreshHistory("event1")

        assertTrue(result.isFailure)
    }

    @Test
    fun `getGame returns cached game`() = runTest {
        val game = makeGame("e1")
        coEvery { gameDao.getGame("e1") } returns game

        assertEquals(game, repository.getGame("e1"))
    }

    @Test
    fun `getGame returns null when not cached`() = runTest {
        coEvery { gameDao.getGame("missing") } returns null

        assertNull(repository.getGame("missing"))
    }

    private fun makeGame(id: String) = WearGameEntity(
        id = id,
        title = "Game $id",
        location = "Field",
        dateTime = "2025-01-01T10:00:00Z",
        sport = "Soccer",
        maxPlayers = 10,
        playerCount = 5,
        teamOneName = "Team 1",
        teamTwoName = "Team 2",
        isRecurring = false,
        archivedAt = null,
        type = "owned",
    )
}
