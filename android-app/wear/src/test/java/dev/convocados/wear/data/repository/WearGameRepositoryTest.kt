package dev.convocados.wear.data.repository

import app.cash.turbine.test
import dev.convocados.wear.data.api.EventSummary
import dev.convocados.wear.data.api.GameHistory
import dev.convocados.wear.data.api.MyGamesResponse
import dev.convocados.wear.data.api.PaginatedHistory
import dev.convocados.wear.data.api.SetScore
import dev.convocados.wear.data.api.TeamInfo
import dev.convocados.wear.data.api.TeamsResponse
import dev.convocados.wear.data.api.WearApiClient
import dev.convocados.wear.data.local.dao.PendingScoreDao
import dev.convocados.wear.data.local.dao.WearGameDao
import dev.convocados.wear.data.local.dao.WearHistoryDao
import dev.convocados.wear.data.local.entity.PendingScoreEntity
import dev.convocados.wear.data.local.entity.WearGameEntity
import io.mockk.*
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.channels.Channel
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
    private val teamRepository = mockk<WearTeamRepository>(relaxUnitFun = true)

    private lateinit var repository: WearGameRepository

    @Before
    fun setup() {
        repository = WearGameRepository(client, gameDao, historyDao, teamRepository, pendingScoreDao)
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
