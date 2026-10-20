package dev.convocados.wear.data.repository

import app.cash.turbine.test
import dev.convocados.wear.data.api.ApiException
import dev.convocados.wear.data.api.EventSummary
import dev.convocados.wear.data.api.GameHistory
import dev.convocados.wear.data.api.MyGamesResponse
import dev.convocados.wear.data.api.PaginatedHistory
import dev.convocados.wear.data.api.SetScore
import dev.convocados.wear.data.api.TeamInfo
import dev.convocados.wear.data.api.TeamsResponse
import dev.convocados.wear.data.api.WatchGameResponse
import dev.convocados.wear.data.api.WearApiClient
import dev.convocados.wear.data.local.dao.PendingActionDao
import dev.convocados.wear.data.local.dao.PendingScoreDao
import dev.convocados.wear.data.local.dao.WearGameDao
import dev.convocados.wear.data.local.dao.WearHistoryDao
import dev.convocados.wear.data.local.entity.PendingActionEntity
import dev.convocados.wear.data.local.entity.PendingScoreEntity
import dev.convocados.wear.data.local.entity.WearGameEntity
import dev.convocados.wear.data.local.entity.WearHistoryEntity
import io.mockk.*
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.runTest
import java.io.IOException
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

class WearGameRepositoryTest {

    private val client = mockk<WearApiClient>()
    private val gameDao = mockk<WearGameDao>(relaxed = true)
    private val historyDao = mockk<WearHistoryDao>(relaxed = true)
    private val pendingScoreDao = mockk<PendingScoreDao>(relaxed = true)
    private val pendingActionDao = mockk<PendingActionDao>(relaxed = true)
    private val teamRepository = mockk<WearTeamRepository>(relaxUnitFun = true)

    private lateinit var repository: WearGameRepository

    @Before
    fun setup() {
        repository = WearGameRepository(client, gameDao, historyDao, teamRepository, pendingScoreDao, pendingActionDao)
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
            owned = listOf(EventSummary("1", "Game 1", "Field A", "2025-01-01T10:00:00Z", "Soccer", 10, 5)),
            followed = listOf(EventSummary("2", "Game 2", "Field B", "2025-01-02T10:00:00Z", "Basketball", 8, 4)),
        )
        coEvery { client.get<MyGamesResponse>(any()) } returns response

        val result = repository.refreshGames()

        assertTrue(result.isSuccess)
        coVerify { gameDao.refreshGames("owned", any()) }
        coVerify { gameDao.refreshGames("followed", any()) }
    }

    @Test
    fun `refreshGames prefetches distinct active teams concurrently`() = runTest {
        val response = MyGamesResponse(
            owned = listOf(eventSummary("1"), eventSummary("2")),
            admin = listOf(eventSummary("2"), eventSummary("3")),
            followed = listOf(eventSummary("3"), eventSummary("4")),
        )
        val started = Channel<String>(Channel.UNLIMITED)
        val release = CompletableDeferred<Unit>()
        val teamsResponse = TeamsResponse(TeamInfo("Team 1"), TeamInfo("Team 2"), maxPlayers = 10)
        coEvery { client.get<MyGamesResponse>(any()) } returns response
        coEvery { teamRepository.refreshTeams(any()) } coAnswers {
            started.send(firstArg())
            release.await()
            Result.success(teamsResponse)
        }

        val refresh = async { repository.refreshGames() }
        val startedIds = buildSet {
            repeat(4) { add(started.receive()) }
        }

        assertEquals(setOf("1", "2", "3", "4"), startedIds)
        release.complete(Unit)
        assertTrue(refresh.await().isSuccess)
        coVerify(exactly = 1) { teamRepository.refreshTeams("1") }
        coVerify(exactly = 1) { teamRepository.refreshTeams("2") }
        coVerify(exactly = 1) { teamRepository.refreshTeams("3") }
        coVerify(exactly = 1) { teamRepository.refreshTeams("4") }
    }

    @Test
    fun `refreshGames keeps successful team prefetches when one game fails`() = runTest {
        val response = MyGamesResponse(
            owned = listOf(eventSummary("1"), eventSummary("2")),
        )
        val teamsResponse = TeamsResponse(TeamInfo("Team 1"), TeamInfo("Team 2"), maxPlayers = 10)
        coEvery { client.get<MyGamesResponse>(any()) } returns response
        coEvery { teamRepository.refreshTeams("1") } throws IllegalStateException("team unavailable")
        coEvery { teamRepository.refreshTeams("2") } returns Result.success(teamsResponse)

        val result = repository.refreshGames()

        assertTrue(result.isSuccess)
        coVerify(exactly = 1) { teamRepository.refreshTeams("1") }
        coVerify(exactly = 1) { teamRepository.refreshTeams("2") }
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
                GameHistory(
                    id = "h1", dateTime = "2025-01-01T10:00:00Z", status = "played",
                    scoreOne = 3, scoreTwo = 2, teamOneName = "Red", teamTwoName = "Blue",
                ),
            ),
        )
        coEvery { client.get<PaginatedHistory>(any()) } returns history

        val result = repository.refreshHistory("event1")

        assertTrue(result.isSuccess)
        coVerify { historyDao.refreshHistory("event1", any()) }
    }

    @Test
    fun `refreshHistory preserves pending optimistic structured score`() = runTest {
        val sets = listOf(SetScore(1, 0, pointTeamOne = 2, pointTeamTwo = 0, pointGameActive = true))
        val pending = PendingScoreEntity(
            eventId = "event1",
            historyId = "h1",
            scoreOne = 0,
            scoreTwo = 0,
            teamOneName = "Red",
            teamTwoName = "Blue",
            scoreSetsJson = kotlinx.serialization.json.Json.encodeToString(sets),
        )
        val remote = PaginatedHistory(
            data = listOf(
                GameHistory(
                    id = "h1", dateTime = "2025-01-01T10:00:00Z", status = "played",
                    scoreOne = null, scoreTwo = null, teamOneName = "Red", teamTwoName = "Blue",
                ),
            ),
        )
        val refreshed = slot<List<dev.convocados.wear.data.local.entity.WearHistoryEntity>>()
        coEvery { client.get<PaginatedHistory>(any()) } returns remote
        coEvery { pendingScoreDao.getAll() } returns listOf(pending)
        coEvery { historyDao.getByEvent("event1") } returns emptyList()
        coEvery { historyDao.refreshHistory("event1", capture(refreshed)) } just Runs

        assertTrue(repository.refreshHistory("event1").isSuccess)
        assertEquals(pending.scoreSetsJson, refreshed.captured.single().scoreSetsJson)
        assertEquals(0, refreshed.captured.single().scoreOne)
        assertEquals(0, refreshed.captured.single().scoreTwo)
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

    // --- #1343 offline queue: start game ---

    @Test
    fun `startGame accepts offline by seeding a local history and queueing the start`() = runTest {
        coEvery { client.startWatchGame("e1") } throws IOException("Offline")
        coEvery { gameDao.getGame("e1") } returns makeGame("e1")
        coEvery { historyDao.getByEvent("e1") } returns emptyList()

        val result = repository.startGame("e1")

        assertTrue(result.isSuccess)
        coVerify {
            pendingActionDao.insert(
                match { it.kind == PendingActionEntity.KIND_START_GAME && it.eventId == "e1" },
            )
        }
        coVerify {
            historyDao.insertAll(
                match { rows ->
                    rows.single().id == WearGameRepository.LOCAL_START_PREFIX + "e1" &&
                        rows.single().eventId == "e1"
                },
            )
        }
    }

    @Test
    fun `startGame does not queue a permanent server rejection`() = runTest {
        coEvery { client.startWatchGame("e1") } throws ApiException(400, "Assign teams first")

        val result = repository.startGame("e1")

        assertTrue(result.isFailure)
        coVerify(exactly = 0) { pendingActionDao.insert(any()) }
        coVerify(exactly = 0) { historyDao.insertAll(any()) }
    }

    @Test
    fun `syncPendingStarts rekeys the local history and queued scores to the server id`() = runTest {
        val action = PendingActionEntity(
            id = 1L,
            kind = PendingActionEntity.KIND_START_GAME,
            eventId = "e1",
            idempotencyKey = "key",
        )
        val local = WearHistoryEntity(
            id = WearGameRepository.LOCAL_START_PREFIX + "e1",
            eventId = "e1",
            dateTime = "2025-01-01T10:00:00Z",
            scoreOne = 2,
            scoreTwo = 1,
            teamOneName = "Red",
            teamTwoName = "Blue",
            editable = true,
        )
        coEvery { pendingActionDao.getByKind(PendingActionEntity.KIND_START_GAME) } returns listOf(action)
        coEvery { client.createWatchGameHistory("e1") } returns WatchGameResponse(id = "h1", created = true)
        coEvery { historyDao.getByEvent("e1") } returns listOf(local)
        coEvery { client.get<PaginatedHistory>(any()) } returns PaginatedHistory(
            data = listOf(GameHistory(id = "h1", dateTime = "2025-01-01T10:00:00Z", teamOneName = "Red", teamTwoName = "Blue")),
        )
        coEvery { pendingScoreDao.getAll() } returns emptyList()

        val synced = repository.syncPendingStarts()

        assertEquals(1, synced)
        coVerify { pendingScoreDao.rekeyHistory(WearGameRepository.LOCAL_START_PREFIX + "e1", "h1") }
        coVerify { historyDao.insertAll(match { rows -> rows.any { it.id == "h1" } }) }
        coVerify { historyDao.deleteById(WearGameRepository.LOCAL_START_PREFIX + "e1") }
        coVerify { pendingActionDao.deleteById(1L) }
    }

    @Test
    fun `syncPendingStarts discards the queued start and refetches when the server wins`() = runTest {
        val action = PendingActionEntity(
            id = 2L,
            kind = PendingActionEntity.KIND_START_GAME,
            eventId = "e1",
            idempotencyKey = "key",
        )
        val local = WearHistoryEntity(
            id = WearGameRepository.LOCAL_START_PREFIX + "e1",
            eventId = "e1",
            dateTime = "2025-01-01T10:00:00Z",
            scoreOne = 0,
            scoreTwo = 0,
            teamOneName = "Red",
            teamTwoName = "Blue",
            editable = true,
        )
        coEvery { pendingActionDao.getByKind(PendingActionEntity.KIND_START_GAME) } returns listOf(action)
        coEvery { client.createWatchGameHistory("e1") } throws ApiException(409, "conflict")
        coEvery { historyDao.getByEvent("e1") } returns listOf(local)
        coEvery { client.get<PaginatedHistory>(any()) } returns PaginatedHistory(data = emptyList())

        val synced = repository.syncPendingStarts()

        assertEquals(0, synced)
        coVerify { pendingActionDao.deleteById(2L) }
        coVerify { pendingScoreDao.deleteByHistory("e1", WearGameRepository.LOCAL_START_PREFIX + "e1") }
        coVerify { historyDao.deleteById(WearGameRepository.LOCAL_START_PREFIX + "e1") }
        coVerify { client.get<PaginatedHistory>(any()) }
    }

    @Test
    fun `syncPendingStarts keeps the local game when auth fails`() = runTest {
        var id = 3L
        for (code in listOf(401, 403)) {
            val action = PendingActionEntity(
                id = id,
                kind = PendingActionEntity.KIND_START_GAME,
                eventId = "e1",
                idempotencyKey = "key",
            )
            val local = WearHistoryEntity(
                id = WearGameRepository.LOCAL_START_PREFIX + "e1",
                eventId = "e1",
                dateTime = "2025-01-01T10:00:00Z",
                scoreOne = 4,
                scoreTwo = 3,
                teamOneName = "Red",
                teamTwoName = "Blue",
                editable = true,
            )
            coEvery { pendingActionDao.getByKind(PendingActionEntity.KIND_START_GAME) } returns listOf(action)
            coEvery { client.createWatchGameHistory("e1") } throws ApiException(code, "expired")
            coEvery { historyDao.getByEvent("e1") } returns listOf(local)

            val synced = repository.syncPendingStarts()

            assertEquals(0, synced)
            coVerify { pendingActionDao.incrementRetry(id) }
            coVerify(exactly = 0) { pendingActionDao.deleteById(id) }
            coVerify(exactly = 0) { pendingScoreDao.deleteByHistory(any(), any()) }
            coVerify(exactly = 0) { historyDao.deleteById(any()) }
            id++
        }
    }

    @Test
    fun `refreshHistory drops a local placeholder when no start is queued`() = runTest {
        val local = WearHistoryEntity(
            id = WearGameRepository.LOCAL_START_PREFIX + "e1",
            eventId = "e1",
            dateTime = "2025-01-01T10:00:00Z",
            scoreOne = 0,
            scoreTwo = 0,
            teamOneName = "Red",
            teamTwoName = "Blue",
            editable = true,
        )
        coEvery { historyDao.getByEvent("e1") } returns listOf(local)
        coEvery { pendingActionDao.getByKindAndEvent(PendingActionEntity.KIND_START_GAME, "e1") } returns emptyList()
        coEvery { client.get<PaginatedHistory>(any()) } returns PaginatedHistory(data = emptyList())
        coEvery { pendingScoreDao.getAll() } returns emptyList()

        val result = repository.refreshHistory("e1")

        assertTrue(result.isSuccess)
        coVerify { historyDao.refreshHistory("e1", match { it.isEmpty() }) }
    }

    private fun eventSummary(id: String) = EventSummary(
        id = id,
        title = "Game $id",
        location = "Field",
        dateTime = "2025-01-01T10:00:00Z",
        sport = "Soccer",
        maxPlayers = 10,
        playerCount = 5,
    )

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
