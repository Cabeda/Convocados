package dev.convocados.wear.data.repository

import app.cash.turbine.test
import dev.convocados.wear.data.api.EventSummary
import dev.convocados.wear.data.api.GameHistory
import dev.convocados.wear.data.api.MyGamesResponse
import dev.convocados.wear.data.api.PaginatedHistory
import dev.convocados.wear.data.api.WearApiClient
import dev.convocados.wear.data.local.dao.PendingScoreDao
import dev.convocados.wear.data.local.dao.WearGameDao
import dev.convocados.wear.data.local.dao.WearHistoryDao
import dev.convocados.wear.data.local.entity.PendingScoreEntity
import dev.convocados.wear.data.local.entity.WearGameEntity
import dev.convocados.wear.data.local.entity.WearHistoryEntity
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
    private val pendingScoreDao = mockk<PendingScoreDao>(relaxed = true)

    private lateinit var repository: WearGameRepository

    @Before
    fun setup() {
        repository = WearGameRepository(client, gameDao, historyDao, pendingScoreDao)
    }

    // ── observeGames ─────────────────────────────────────────────────────

    @Test
    fun `observeGames delegates to gameDao`() = runTest {
        val games = listOf(makeGame("1"), makeGame("2"))
        coEvery { gameDao.getAllGames() } returns flowOf(games)

        repository.observeGames().test {
            assertEquals(games, awaitItem())
            awaitComplete()
        }
    }

    // ── refreshGames ─────────────────────────────────────────────────────

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

    // ── refreshHistory ───────────────────────────────────────────────────

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

    // ── submitScore ──────────────────────────────────────────────────────

    @Test
    fun `submitScore updates local cache optimistically`() = runTest {
        coEvery { client.patch<GameHistory>(any(), any()) } returns GameHistory(
            "h1", "2025-01-01T10:00:00Z", "played", 5, 3, "Red", "Blue", true,
        )

        val result = repository.submitScore("e1", "h1", 5, 3, "Red", "Blue")

        assertTrue(result.isSuccess)
        coVerify { historyDao.updateScore("h1", 5, 3) }
    }

    @Test
    fun `submitScore queues pending score on network failure`() = runTest {
        coEvery { client.patch<GameHistory>(any(), any()) } throws Exception("Offline")

        val result = repository.submitScore("e1", "h1", 5, 3, "Red", "Blue")

        // Still returns success (queued for later)
        assertTrue(result.isSuccess)
        coVerify { pendingScoreDao.insert(match { it.eventId == "e1" && it.scoreOne == 5 }) }
    }

    // ── syncPendingScores ────────────────────────────────────────────────

    @Test
    fun `syncPendingScores syncs all pending and deletes them`() = runTest {
        val pending = listOf(
            PendingScoreEntity(1, "e1", "h1", 3, 2, "A", "B"),
            PendingScoreEntity(2, "e2", "h2", 1, 0, "C", "D"),
        )
        coEvery { pendingScoreDao.getAll() } returns pending
        coEvery { client.patch<GameHistory>(any(), any()) } returns GameHistory(
            "h1", "2025-01-01T10:00:00Z", "played", 3, 2, "A", "B", true,
        )

        val synced = repository.syncPendingScores()

        assertEquals(2, synced)
        coVerify(exactly = 2) { pendingScoreDao.delete(any()) }
        coVerify { pendingScoreDao.deleteStale() }
    }

    @Test
    fun `syncPendingScores increments retry on failure`() = runTest {
        val pending = listOf(PendingScoreEntity(1, "e1", "h1", 3, 2, "A", "B"))
        coEvery { pendingScoreDao.getAll() } returns pending
        coEvery { client.patch<GameHistory>(any(), any()) } throws Exception("Still offline")

        val synced = repository.syncPendingScores()

        assertEquals(0, synced)
        coVerify { pendingScoreDao.incrementRetry(1) }
        coVerify { pendingScoreDao.deleteStale() }
    }

    // ── observePendingCount ──────────────────────────────────────────────

    @Test
    fun `observePendingCount delegates to pendingScoreDao`() = runTest {
        coEvery { pendingScoreDao.observeCount() } returns flowOf(3)

        repository.observePendingCount().test {
            assertEquals(3, awaitItem())
            awaitComplete()
        }
    }

    // ── getGame ──────────────────────────────────────────────────────────

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

    // ── Helpers ──────────────────────────────────────────────────────────

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
