package dev.convocados.wear.data.repository

import app.cash.turbine.test
import dev.convocados.wear.data.api.GameHistory
import dev.convocados.wear.data.api.WearApiClient
import dev.convocados.wear.data.local.dao.PendingScoreDao
import dev.convocados.wear.data.local.dao.WearHistoryDao
import dev.convocados.wear.data.local.entity.PendingScoreEntity
import io.mockk.*
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

class WearScoreRepositoryTest {

    private val client = mockk<WearApiClient>()
    private val historyDao = mockk<WearHistoryDao>(relaxed = true)
    private val pendingScoreDao = mockk<PendingScoreDao>(relaxed = true)

    private lateinit var repository: WearScoreRepository

    @Before
    fun setup() {
        repository = WearScoreRepository(client, historyDao, pendingScoreDao)
    }

    @Test
    fun `observePendingCount delegates to pendingScoreDao`() = runTest {
        coEvery { pendingScoreDao.observeCount() } returns flowOf(3)

        repository.observePendingCount().test {
            assertEquals(3, awaitItem())
            awaitComplete()
        }
    }

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

        assertTrue(result.isFailure)
        coVerify { pendingScoreDao.insert(match { it.eventId == "e1" && it.scoreOne == 5 }) }
    }

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
}
