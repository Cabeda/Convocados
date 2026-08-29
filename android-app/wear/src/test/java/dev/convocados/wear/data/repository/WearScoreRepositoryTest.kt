package dev.convocados.wear.data.repository

import app.cash.turbine.test
import dev.convocados.wear.data.api.ApiException
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
    fun `syncPendingScores compares structured baselines without nullable scalar totals`() = runTest {
        val baselineSets = listOf(SetScore(1, 0, pointTeamOne = 1, pointTeamTwo = 0, pointGameActive = true))
        val targetSets = listOf(SetScore(1, 0, pointTeamOne = 2, pointTeamTwo = 0, pointGameActive = true))
        val baselineJson = kotlinx.serialization.json.Json.encodeToString(baselineSets)
        val targetJson = kotlinx.serialization.json.Json.encodeToString(targetSets)
        val pending = PendingScoreEntity(
            id = 1,
            eventId = "e1",
            historyId = "h1",
            scoreOne = 0,
            scoreTwo = 0,
            teamOneName = "A",
            teamTwoName = "B",
            basedOnScoreOne = 0,
            basedOnScoreTwo = 0,
            scoreSetsJson = targetJson,
            basedOnScoreSetsJson = baselineJson,
        )
        coEvery { pendingScoreDao.getAll() } returns listOf(pending)
        coEvery { client.getGameHistory(any()) } returns GameHistory(
            id = "h1", dateTime = "2025-01-01T10:00:00Z", status = "played",
            scoreOne = null, scoreTwo = null, scoreSets = baselineSets, teamOneName = "A", teamTwoName = "B",
        )
        coEvery { client.patchGameHistory(any(), any()) } returns GameHistory(
            id = "h1", dateTime = "2025-01-01T10:00:00Z", status = "played",
            scoreOne = null, scoreTwo = null, scoreSets = targetSets, teamOneName = "A", teamTwoName = "B",
        )

        assertEquals(1, repository.syncPendingScores())
        coVerify { client.patchGameHistory(any(), match { (it as dev.convocados.wear.data.api.ScoreRequest).scoreSets == targetSets }) }
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
    fun `syncPendingScores patches through intentionally redacted participant score`() = runTest {
        val pending = PendingScoreEntity(
            id = 5,
            eventId = "e1",
            historyId = "h1",
            scoreOne = 2,
            scoreTwo = 1,
            teamOneName = "A",
            teamTwoName = "B",
            basedOnScoreOne = 1,
            basedOnScoreTwo = 0,
            baselineCaptured = true,
        )
        coEvery { pendingScoreDao.getAll() } returns listOf(pending)
        coEvery { client.getGameHistory(any()) } returns GameHistory(
            id = "h1", dateTime = "2025-01-01T10:00:00Z", status = "played",
            scoreOne = null, scoreTwo = null, scoreSets = null, teamOneName = "A", teamTwoName = "B",
        )
        coEvery { client.patchGameHistory(any(), any()) } returns GameHistory(
            id = "h1", dateTime = "2025-01-01T10:00:00Z", status = "played",
            scoreOne = null, scoreTwo = null, teamOneName = "A", teamTwoName = "B",
        )

        assertEquals(1, repository.syncPendingScores())
        coVerify { client.patchGameHistory(any(), match { it is ScalarScoreRequest && it.scoreOne == 2 && it.scoreTwo == 1 }) }
        coVerify { pendingScoreDao.delete(pending) }
    }

    @Test
    fun `syncPendingScores removes queued score rejected by API`() = runTest {
        val pending = PendingScoreEntity(
            eventId = "e1",
            historyId = "h1",
            scoreOne = 1,
            scoreTwo = 0,
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
        coEvery { client.patchGameHistory(any(), any()) } throws ApiException(422, "Invalid score")

        assertEquals(0, repository.syncPendingScores())
        coVerify { pendingScoreDao.delete(pending) }
        coVerify(exactly = 0) { pendingScoreDao.incrementRetry(any()) }
    }

    @Test
    fun `syncPendingScores compares structured baseline even when migration marker is false`() = runTest {
        val baselineSets = listOf(SetScore(1, 0, pointTeamOne = 1, pointTeamTwo = 0, pointGameActive = true))
        val targetSets = listOf(SetScore(1, 0, pointTeamOne = 2, pointTeamTwo = 0, pointGameActive = true))
        val pending = PendingScoreEntity(
            id = 4,
            eventId = "e1",
            historyId = "h1",
            scoreOne = 0,
            scoreTwo = 0,
            teamOneName = "A",
            teamTwoName = "B",
            scoreSetsJson = kotlinx.serialization.json.Json.encodeToString(targetSets),
            basedOnScoreSetsJson = kotlinx.serialization.json.Json.encodeToString(baselineSets),
            baselineCaptured = false,
        )
        coEvery { pendingScoreDao.getAll() } returns listOf(pending)
        coEvery { client.getGameHistory(any()) } returns GameHistory(
            id = "h1", dateTime = "2025-01-01T10:00:00Z", status = "played",
            scoreOne = null, scoreTwo = null,
            scoreSets = targetSets.map { it.copy(pointTeamOne = 3) },
            teamOneName = "A", teamTwoName = "B",
        )

        assertEquals(0, repository.syncPendingScores())
        coVerify { pendingScoreDao.incrementRetry(4) }
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
    fun `newer score submission supersedes an older queued edit`() = runTest {
        var attempts = 0
        coEvery { client.patchGameHistory(any(), any()) } answers {
            if (attempts++ == 0) throw Exception("Offline")
            GameHistory(id = "h1", dateTime = "2025-01-01T10:00:00Z", status = "played", scoreOne = 2, scoreTwo = 1)
        }

        assertTrue(repository.submitScore("e1", "h1", 0, 0, "A", "B", listOf(SetScore(0, 0))).isFailure)
        assertTrue(repository.submitScore("e1", "h1", 2, 1, "A", "B").isSuccess)

        coVerify(exactly = 2) { pendingScoreDao.deleteByHistory("e1", "h1") }
    }

    @Test
    fun `consecutive offline edits preserve the original server baseline`() = runTest {
        val firstSets = listOf(SetScore(1, 0, pointTeamOne = 1, pointTeamTwo = 0, pointGameActive = true))
        val secondSets = listOf(SetScore(1, 0, pointTeamOne = 2, pointTeamTwo = 0, pointGameActive = true))
        val firstPending = PendingScoreEntity(
            id = 1,
            eventId = "e1",
            historyId = "h1",
            scoreOne = 0,
            scoreTwo = 0,
            teamOneName = "A",
            teamTwoName = "B",
            basedOnScoreOne = 0,
            basedOnScoreTwo = 0,
            scoreSetsJson = kotlinx.serialization.json.Json.encodeToString(firstSets),
            basedOnScoreSetsJson = null,
        )
        val queued = slot<PendingScoreEntity>()
        coEvery { pendingScoreDao.getByHistory("e1", "h1") } returnsMany listOf(emptyList(), listOf(firstPending))
        coEvery { pendingScoreDao.insert(capture(queued)) } just Runs
        coEvery { pendingScoreDao.getAll() } answers { listOf(queued.captured) }
        coEvery { client.getGameHistory(any()) } returns GameHistory(
            id = "h1", dateTime = "2025-01-01T10:00:00Z", status = "played",
            scoreOne = 0, scoreTwo = 0, scoreSets = null, teamOneName = "A", teamTwoName = "B",
        )
        var attempts = 0
        coEvery { client.patchGameHistory(any(), any()) } answers {
            if (attempts++ < 2) throw Exception("Offline")
            GameHistory(id = "h1", dateTime = "2025-01-01T10:00:00Z", status = "played", scoreOne = null, scoreTwo = null, scoreSets = secondSets)
        }

        assertTrue(repository.submitScore("e1", "h1", 0, 0, "A", "B", firstSets).isFailure)
        assertTrue(repository.submitScore("e1", "h1", 0, 0, "A", "B", secondSets).isFailure)
        assertEquals(0, queued.captured.basedOnScoreOne)
        assertNull(queued.captured.basedOnScoreSetsJson)

        assertEquals(1, repository.syncPendingScores())
        coVerify { client.patchGameHistory(any(), match { (it as dev.convocados.wear.data.api.ScoreRequest).scoreSets == secondSets }) }
    }

    @Test
    fun `newer direct edit queues instead of overwriting a changed server baseline`() = runTest {
        val queued = PendingScoreEntity(
            id = 7,
            eventId = "e1",
            historyId = "h1",
            scoreOne = 1,
            scoreTwo = 0,
            teamOneName = "A",
            teamTwoName = "B",
            basedOnScoreOne = 0,
            basedOnScoreTwo = 0,
            baselineCaptured = true,
        )
        val replacement = slot<PendingScoreEntity>()
        coEvery { pendingScoreDao.getByHistory("e1", "h1") } returns listOf(queued)
        coEvery { historyDao.getHistoryById("h1") } returns null
        coEvery { client.getGameHistory("/api/events/e1/history/h1") } returns GameHistory(
            id = "h1", dateTime = "2025-01-01T10:00:00Z", status = "played",
            scoreOne = 2, scoreTwo = 0, teamOneName = "A", teamTwoName = "B",
        )
        coEvery { pendingScoreDao.insert(capture(replacement)) } just Runs

        val result = repository.submitScore("e1", "h1", 3, 1, "A", "B")

        assertTrue(result.isFailure)
        coVerify(exactly = 0) { client.patchGameHistory(any(), any()) }
        coVerify { pendingScoreDao.deleteByHistory("e1", "h1") }
        assertEquals(3, replacement.captured.scoreOne)
        assertEquals(1, replacement.captured.scoreTwo)
        assertEquals(0, replacement.captured.basedOnScoreOne)
        assertEquals(0, replacement.captured.basedOnScoreTwo)
        assertTrue(replacement.captured.baselineCaptured)
    }

    @Test
    fun `server rejected newer edit removes older queued target`() = runTest {
        val queued = PendingScoreEntity(
            id = 7,
            eventId = "e1",
            historyId = "h1",
            scoreOne = 1,
            scoreTwo = 0,
            teamOneName = "A",
            teamTwoName = "B",
            basedOnScoreOne = 0,
            basedOnScoreTwo = 0,
            baselineCaptured = true,
        )
        coEvery { pendingScoreDao.getByHistory("e1", "h1") } returns listOf(queued)
        coEvery { historyDao.getHistoryById("h1") } returns null
        coEvery { client.getGameHistory(any()) } returns GameHistory(
            id = "h1", dateTime = "2025-01-01T10:00:00Z", status = "played",
            scoreOne = 0, scoreTwo = 0, teamOneName = "A", teamTwoName = "B",
        )
        coEvery { client.patchGameHistory(any(), any()) } throws ApiException(422, "Invalid score")

        val result = repository.submitScore("e1", "h1", 3, 1, "A", "B")

        assertTrue(result.isFailure)
        coVerify { pendingScoreDao.deleteByHistory("e1", "h1") }
        coVerify(exactly = 0) { pendingScoreDao.insert(any()) }
    }

    @Test
    fun `missing local history creates an uncaptured baseline`() = runTest {
        val queued = slot<PendingScoreEntity>()
        coEvery { historyDao.getHistoryById("h1") } returns null
        coEvery { client.patchGameHistory(any(), any()) } throws Exception("Offline")
        coEvery { pendingScoreDao.insert(capture(queued)) } just Runs

        val result = repository.submitScore("e1", "h1", 3, 1, "A", "B")

        assertTrue(result.isFailure)
        assertFalse(queued.captured.baselineCaptured)
        assertNull(queued.captured.basedOnScoreOne)
        assertNull(queued.captured.basedOnScoreTwo)
    }

    @Test
    fun `consecutive failed edits retain the original baseline and latest target`() = runTest {
        val firstPending = PendingScoreEntity(
            id = 1,
            eventId = "e1",
            historyId = "h1",
            scoreOne = 1,
            scoreTwo = 0,
            teamOneName = "A",
            teamTwoName = "B",
            basedOnScoreOne = 0,
            basedOnScoreTwo = 0,
            baselineCaptured = true,
        )
        val latest = slot<PendingScoreEntity>()
        coEvery { pendingScoreDao.getByHistory("e1", "h1") } returnsMany listOf(emptyList(), listOf(firstPending))
        coEvery { historyDao.getHistoryById("h1") } returns null
        coEvery { client.patchGameHistory(any(), any()) } throws Exception("Offline")
        coEvery { pendingScoreDao.insert(capture(latest)) } just Runs

        assertTrue(repository.submitScore("e1", "h1", 1, 0, "A", "B").isFailure)
        assertTrue(repository.submitScore("e1", "h1", 2, 1, "A", "B").isFailure)

        assertEquals(2, latest.captured.scoreOne)
        assertEquals(1, latest.captured.scoreTwo)
        assertEquals(0, latest.captured.basedOnScoreOne)
        assertEquals(0, latest.captured.basedOnScoreTwo)
        assertTrue(latest.captured.baselineCaptured)
    }

    @Test
    fun `submitScore persists tennis sets and sends structured payload`() = runTest {
        val sets = listOf(SetScore(3, 2, pointTeamOne = 2, pointTeamTwo = 3, pointGameActive = true))
        coEvery { client.patchGameHistory(any(), any()) } returns GameHistory(
            id = "h1", dateTime = "2025-01-01T10:00:00Z", status = "played",
            scoreOne = 2, scoreTwo = 0, scoreSets = sets, scoringType = "tennis",
            teamOneName = "Red", teamTwoName = "Blue",
        )

        val result = repository.submitScore("e1", "h1", 2, 0, "Red", "Blue", sets)

        assertTrue(result.isSuccess)
        val scoreSetsJson = slot<String>()
        coVerify { historyDao.updateScore("h1", 2, 0, capture(scoreSetsJson)) }
        assertTrue(scoreSetsJson.captured.contains("pointTeamOne"))
        coVerify { client.patchGameHistory("/api/events/e1/history/h1", match { (it as dev.convocados.wear.data.api.ScoreRequest).scoreSets == sets }) }
    }

}
