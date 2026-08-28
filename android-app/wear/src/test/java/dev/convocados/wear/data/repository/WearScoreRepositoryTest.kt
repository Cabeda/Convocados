package dev.convocados.wear.data.repository

import app.cash.turbine.test
import dev.convocados.wear.data.api.GameHistory
import dev.convocados.wear.data.api.ScalarScoreRequest
import dev.convocados.wear.data.api.WearApiClient
import dev.convocados.wear.data.api.SetScore
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
        coEvery { client.patchGameHistory(any(), any()) } returns GameHistory(
            id = "h1", dateTime = "2025-01-01T10:00:00Z", status = "played",
            scoreOne = 5, scoreTwo = 3, teamOneName = "Red", teamTwoName = "Blue",
        )

        val result = repository.submitScore("e1", "h1", 5, 3, "Red", "Blue")

        assertTrue(result.isSuccess)
        coVerify { historyDao.updateScore("h1", 5, 3) }
    }

    @Test
    fun `submitScore queues pending score on network failure`() = runTest {
        coEvery { client.patchGameHistory(any(), any()) } throws Exception("Offline")

        val result = repository.submitScore("e1", "h1", 5, 3, "Red", "Blue")

        assertTrue(result.isFailure)
        coVerify { pendingScoreDao.insert(match { it.eventId == "e1" && it.scoreOne == 5 }) }
    }

    @Test
    fun `syncPendingScores syncs all pending and deletes them`() = runTest {
        val pending = listOf(
            PendingScoreEntity(
                1, "e1", "h1", 3, 2, "A", "B",
                basedOnScoreOne = 3,
                basedOnScoreTwo = 2,
            ),
            PendingScoreEntity(
                2, "e2", "h2", 1, 0, "C", "D",
                basedOnScoreOne = 0,
                basedOnScoreTwo = 0,
            ),
        )
        coEvery { pendingScoreDao.getAll() } returns pending
        coEvery { client.patchGameHistory(any(), any()) } returns GameHistory(
            id = "h2", dateTime = "2025-01-01T10:00:00Z", status = "played",
            scoreOne = 1, scoreTwo = 0, teamOneName = "C", teamTwoName = "D",
        )
        coEvery { client.getGameHistory("/api/events/e1/history/h1") } returns GameHistory(
            id = "h1", dateTime = "2025-01-01T10:00:00Z", status = "played",
            scoreOne = 3, scoreTwo = 2, teamOneName = "A", teamTwoName = "B",
        )
        coEvery { client.getGameHistory("/api/events/e2/history/h2") } returns GameHistory(
            id = "h2", dateTime = "2025-01-01T10:00:00Z", status = "played",
            scoreOne = 0, scoreTwo = 0, teamOneName = "C", teamTwoName = "D",
        )

        val synced = repository.syncPendingScores()

        assertEquals(2, synced)
        coVerify(exactly = 2) { pendingScoreDao.delete(any()) }
    }

    @Test
    fun `syncPendingScores replays queued tennis sets`() = runTest {
        val sets = listOf(SetScore(6, 6, 7, 5))
        val pending = PendingScoreEntity(
            id = 1,
            eventId = "e1",
            historyId = "h1",
            scoreOne = 1,
            scoreTwo = 0,
            teamOneName = "A",
            teamTwoName = "B",
            basedOnScoreOne = 0,
            basedOnScoreTwo = 0,
            scoreSetsJson = "[{\"teamOne\":6,\"teamTwo\":6,\"tiebreakTeamOne\":7,\"tiebreakTeamTwo\":5}]",
        )
        coEvery { pendingScoreDao.getAll() } returns listOf(pending)
        coEvery { client.getGameHistory(any()) } returns GameHistory(
            id = "h1", dateTime = "2025-01-01T10:00:00Z", status = "played",
            scoreOne = 0, scoreTwo = 0, teamOneName = "A", teamTwoName = "B",
        )
        coEvery { client.patchGameHistory(any(), any()) } returns GameHistory(
            id = "h1", dateTime = "2025-01-01T10:00:00Z", status = "played",
            scoreOne = 1, scoreTwo = 0, scoreSets = sets, teamOneName = "A", teamTwoName = "B",
        )

        assertEquals(1, repository.syncPendingScores())
        coVerify {
            client.patchGameHistory(
                "/api/events/e1/history/h1",
                match { (it as dev.convocados.wear.data.api.ScoreRequest).scoreSets == sets },
            )
        }
        coVerify { pendingScoreDao.delete(pending) }
    }

    @Test
    fun `syncPendingScores replays queued scalar scores with scalar payload`() = runTest {
        val pending = PendingScoreEntity(
            id = 1,
            eventId = "e1",
            historyId = "h1",
            scoreOne = 3,
            scoreTwo = 2,
            teamOneName = "A",
            teamTwoName = "B",
            basedOnScoreOne = 0,
            basedOnScoreTwo = 0,
        )
        coEvery { pendingScoreDao.getAll() } returns listOf(pending)
        coEvery { client.getGameHistory(any()) } returns GameHistory(
            id = "h1", dateTime = "2025-01-01T10:00:00Z", status = "played",
            scoreOne = 0, scoreTwo = 0, teamOneName = "A", teamTwoName = "B",
        )
        coEvery { client.patchGameHistory(any(), any()) } returns GameHistory(
            id = "h1", dateTime = "2025-01-01T10:00:00Z", status = "played",
            scoreOne = 3, scoreTwo = 2, teamOneName = "A", teamTwoName = "B",
        )

        assertEquals(1, repository.syncPendingScores())
        coVerify {
            client.patchGameHistory(
                "/api/events/e1/history/h1",
                match { it is ScalarScoreRequest && it.scoreOne == 3 && it.scoreTwo == 2 },
            )
        }
        coVerify { pendingScoreDao.delete(pending) }
    }

    @Test
    fun `syncPendingScores preserves legacy unknown-baseline replay behavior`() = runTest {
        val pending = PendingScoreEntity(
            id = 1,
            eventId = "e1",
            historyId = "h1",
            scoreOne = 3,
            scoreTwo = 2,
            teamOneName = "A",
            teamTwoName = "B",
            baselineCaptured = false,
        )
        coEvery { pendingScoreDao.getAll() } returns listOf(pending)
        coEvery { client.getGameHistory(any()) } returns GameHistory(
            id = "h1", dateTime = "2025-01-01T10:00:00Z", status = "played",
            scoreOne = 1, scoreTwo = 0, teamOneName = "A", teamTwoName = "B",
        )
        coEvery { client.patchGameHistory(any(), any()) } returns GameHistory(
            id = "h1", dateTime = "2025-01-01T10:00:00Z", status = "played",
            scoreOne = 3, scoreTwo = 2, teamOneName = "A", teamTwoName = "B",
        )

        assertEquals(1, repository.syncPendingScores())
        coVerify { pendingScoreDao.delete(pending) }
    }

    @Test
    fun `syncPendingScores keeps queued score when server changed from its baseline`() = runTest {
        val pending = PendingScoreEntity(
            id = 1,
            eventId = "e1",
            historyId = "h1",
            scoreOne = 3,
            scoreTwo = 2,
            teamOneName = "A",
            teamTwoName = "B",
            basedOnScoreOne = null,
            basedOnScoreTwo = null,
            baselineCaptured = true,
        )
        coEvery { pendingScoreDao.getAll() } returns listOf(pending)
        coEvery { client.getGameHistory(any()) } returns GameHistory(
            id = "h1", dateTime = "2025-01-01T10:00:00Z", status = "played",
            scoreOne = 2, scoreTwo = 0, teamOneName = "A", teamTwoName = "B",
        )

        assertEquals(0, repository.syncPendingScores())
        coVerify { pendingScoreDao.incrementRetry(1) }
        coVerify(exactly = 0) { client.patchGameHistory(any(), any()) }
    }

    @Test
    fun `syncPendingScores increments retry on failure`() = runTest {
        val pending = listOf(PendingScoreEntity(1, "e1", "h1", 3, 2, "A", "B"))
        coEvery { pendingScoreDao.getAll() } returns pending
        coEvery { client.patchGameHistory(any(), any()) } throws Exception("Still offline")

        val synced = repository.syncPendingScores()

        assertEquals(0, synced)
        coVerify { pendingScoreDao.incrementRetry(1) }
    }

    @Test
    fun `submitScore persists tennis sets and sends structured payload`() = runTest {
        val sets = listOf(SetScore(6, 4), SetScore(7, 6, 7, 5))
        coEvery { client.patchGameHistory(any(), any()) } returns GameHistory(
            id = "h1", dateTime = "2025-01-01T10:00:00Z", status = "played",
            scoreOne = 2, scoreTwo = 0, scoreSets = sets, scoringType = "tennis",
            teamOneName = "Red", teamTwoName = "Blue",
        )

        val result = repository.submitScore("e1", "h1", 2, 0, "Red", "Blue", sets)

        assertTrue(result.isSuccess)
        coVerify { historyDao.updateScore("h1", 2, 0, any()) }
        coVerify { client.patchGameHistory("/api/events/e1/history/h1", match { (it as dev.convocados.wear.data.api.ScoreRequest).scoreSets == sets }) }
    }

}
