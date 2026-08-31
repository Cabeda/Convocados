package dev.convocados.wear.ui.screen.score

import app.cash.turbine.test
import dev.convocados.wear.data.api.ApiException
import dev.convocados.wear.data.api.SetScore
import dev.convocados.wear.data.alarm.GameSettings
import dev.convocados.wear.data.alarm.GameSettingsStore
import dev.convocados.wear.data.local.entity.WearGameEntity
import dev.convocados.wear.data.local.entity.WearHistoryEntity
import dev.convocados.wear.data.repository.WearGameRepository
import dev.convocados.wear.data.repository.WearScoreRepository
import androidx.work.WorkManager
import io.mockk.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.test.*
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit

@OptIn(ExperimentalCoroutinesApi::class)
class ScoreViewModelTest {

    private val repository = mockk<WearGameRepository>(relaxed = true)
    private val scoreRepository = mockk<WearScoreRepository>(relaxed = true)
    private val settingsStore = mockk<GameSettingsStore>(relaxed = true)
    private val workManager = mockk<WorkManager>(relaxed = true)
    private val testDispatcher = StandardTestDispatcher()

    @Before
    fun setup() {
        Dispatchers.setMain(testDispatcher)
        every { settingsStore.settings(any()) } returns MutableStateFlow(GameSettings())
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun makeViewModel(): ScoreViewModel {
        val vm = ScoreViewModel(repository, scoreRepository, settingsStore, workManager)
        vm.tickProvider = { flowOf(Instant.now()) }
        return vm
    }

    @Test
    fun `initial state is loading`() = runTest {
        val viewModel = ScoreViewModel(repository, scoreRepository, settingsStore, workManager)

        viewModel.uiState.test {
            val state = awaitItem()
            assertTrue(state.isLoading)
            assertNull(state.game)
            assertNull(state.history)
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `load fetches game and observes history`() = runTest {
        val game = makeGame("e1")
        val history = makeHistory("h1", "e1", 2, 1)

        coEvery { repository.getGame("e1") } returns game
        coEvery { repository.refreshHistory("e1") } returns Result.success(Unit)
        coEvery { repository.observeLatestHistoryForEvent("e1") } returns flowOf(history)

        val viewModel = makeViewModel()
        viewModel.load("e1")
        advanceUntilIdle()

        viewModel.uiState.test {
            val state = awaitItem()
            assertFalse(state.isLoading)
            assertEquals(game, state.game)
            assertEquals(history, state.history)
            assertEquals(2, state.scoreOne)
            assertEquals(1, state.scoreTwo)
            assertEquals("Red", state.teamOneName)
            assertEquals("Blue", state.teamTwoName)
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `load fetches keepScreenOn from settings`() = runTest {
        val game = makeGame("e1")
        val history = makeHistory("h1", "e1", 0, 0)
        val settingsFlow = MutableStateFlow(GameSettings(keepScreenOn = false))

        every { settingsStore.settings("e1") } returns settingsFlow
        coEvery { repository.getGame("e1") } returns game
        coEvery { repository.refreshHistory("e1") } returns Result.success(Unit)
        coEvery { repository.observeLatestHistoryForEvent("e1") } returns flowOf(history)

        val viewModel = makeViewModel()
        viewModel.load("e1")
        advanceUntilIdle()

        viewModel.uiState.test {
            val state = awaitItem()
            assertFalse(state.keepScreenOn)
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `load exposes the effective kickoff override`() = runTest {
        val game = makeGame("e1", Instant.now().plus(2, ChronoUnit.HOURS))
        val kickoffOverride = Instant.now().minus(5, ChronoUnit.MINUTES).toEpochMilli()
        every { settingsStore.settings("e1") } returns MutableStateFlow(GameSettings(kickoffEpochMs = kickoffOverride))
        coEvery { repository.getGame("e1") } returns game
        coEvery { repository.refreshHistory("e1") } returns Result.success(Unit)
        coEvery { repository.observeLatestHistoryForEvent("e1") } returns flowOf(null)

        val viewModel = makeViewModel()
        viewModel.load("e1")
        advanceUntilIdle()

        assertEquals(kickoffOverride, viewModel.uiState.value.kickoffEpochMs)
    }

    @Test
    fun `load is idempotent for same eventId`() = runTest {
        coEvery { repository.getGame("e1") } returns makeGame("e1")
        coEvery { repository.refreshHistory("e1") } returns Result.success(Unit)
        coEvery { repository.observeLatestHistoryForEvent("e1") } returns flowOf(makeHistory("h1", "e1", 0, 0))

        val viewModel = makeViewModel()
        viewModel.load("e1")
        viewModel.load("e1")
        advanceUntilIdle()

        coVerify(exactly = 1) { repository.getGame("e1") }
    }

    @Test
    fun `incrementScoreOne increments team one`() = runTest {
        coEvery { repository.getGame("e1") } returns makeGame("e1")
        coEvery { repository.refreshHistory("e1") } returns Result.success(Unit)
        coEvery { repository.observeLatestHistoryForEvent("e1") } returns flowOf(makeHistory("h1", "e1", 0, 0))

        val viewModel = makeViewModel()
        viewModel.load("e1")
        advanceUntilIdle()

        viewModel.incrementScoreOne()

        viewModel.uiState.test {
            assertEquals(1, awaitItem().scoreOne)
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `decrementScoreTwo does not go below zero`() = runTest {
        coEvery { repository.getGame("e1") } returns makeGame("e1")
        coEvery { repository.refreshHistory("e1") } returns Result.success(Unit)
        coEvery { repository.observeLatestHistoryForEvent("e1") } returns flowOf(makeHistory("h1", "e1", 0, 0))

        val viewModel = makeViewModel()
        viewModel.load("e1")
        advanceUntilIdle()

        viewModel.decrementScoreTwo()

        viewModel.uiState.test {
            assertEquals(0, awaitItem().scoreTwo)
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `incrementScoreTwo increments team two`() = runTest {
        coEvery { repository.getGame("e1") } returns makeGame("e1")
        coEvery { repository.refreshHistory("e1") } returns Result.success(Unit)
        coEvery { repository.observeLatestHistoryForEvent("e1") } returns flowOf(makeHistory("h1", "e1", 0, 0))

        val viewModel = makeViewModel()
        viewModel.load("e1")
        advanceUntilIdle()

        viewModel.incrementScoreTwo()
        viewModel.incrementScoreTwo()

        viewModel.uiState.test {
            assertEquals(2, awaitItem().scoreTwo)
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `incrementing persists the latest score`() = runTest {
        coEvery { repository.getGame("e1") } returns makeGame("e1")
        coEvery { repository.refreshHistory("e1") } returns Result.success(Unit)
        coEvery { repository.observeLatestHistoryForEvent("e1") } returns flowOf(makeHistory("h1", "e1", 0, 0))
        coEvery { scoreRepository.submitScore(any(), any(), any(), any(), any(), any()) } returns Result.success(Unit)

        val viewModel = makeViewModel()
        viewModel.load("e1")
        advanceUntilIdle()

        viewModel.incrementScoreOne()
        advanceUntilIdle()

        coVerify { scoreRepository.submitScore("e1", "h1", 1, 0, any(), any()) }
    }

    @Test
    fun `rapid taps coalesce into one save with the final score`() = runTest {
        coEvery { repository.getGame("e1") } returns makeGame("e1")
        coEvery { repository.refreshHistory("e1") } returns Result.success(Unit)
        coEvery { repository.observeLatestHistoryForEvent("e1") } returns flowOf(makeHistory("h1", "e1", 0, 0))
        coEvery { scoreRepository.submitScore(any(), any(), any(), any(), any(), any()) } returns Result.success(Unit)

        val viewModel = makeViewModel()
        viewModel.load("e1")
        advanceUntilIdle()

        viewModel.incrementScoreOne()
        viewModel.incrementScoreOne()
        viewModel.incrementScoreOne()
        advanceUntilIdle()

        coVerify(exactly = 1) { scoreRepository.submitScore("e1", "h1", 3, 0, any(), any()) }
        coVerify(exactly = 0) { scoreRepository.submitScore("e1", "h1", 1, 0, any(), any()) }
    }

    @Test
    fun `startGame success leaves no error`() = runTest {
        coEvery { repository.startGame(any()) } returns Result.success(Unit)

        val viewModel = makeViewModel()
        viewModel.startGame()
        advanceUntilIdle()

        viewModel.uiState.test {
            val state = awaitItem()
            assertFalse(state.isStarting)
            assertNull(state.error)
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `score failure only shows offline state for retryable errors`() {
        assertTrue(isRetryableScoreFailure(java.io.IOException("offline")))
        assertTrue(isRetryableScoreFailure(ApiException(401, "expired")))
        assertTrue(isRetryableScoreFailure(ApiException(500, "server")))
        assertFalse(isRetryableScoreFailure(ApiException(422, "invalid")))
    }

    @Test
    fun `startGame failure with 400 asks to assign teams`() {
        assertEquals("Assign teams first", startErrorMessage(ApiException(400, "Teams must be assigned first.")))
    }

    @Test
    fun `startErrorMessage maps auth, other api and network errors`() {
        assertNull(startErrorMessage(null))
        assertEquals("Session expired — sign in again", startErrorMessage(ApiException(401, "x")))
        assertEquals("Couldn't start (500)", startErrorMessage(ApiException(500, "x")))
        assertEquals("Couldn't start — check connection", startErrorMessage(java.io.IOException("offline")))
    }

    @Test
    fun `incrementing a team one tiebreak winner updates match score`() = runTest {
        coEvery { repository.getGame("e1") } returns makeGame("e1").copy(sport = "tennis")
        coEvery { repository.refreshHistory("e1") } returns Result.success(Unit)
        coEvery { repository.observeLatestHistoryForEvent("e1") } returns flowOf(
            makeHistory("h1", "e1", 0, 0, """[{"teamOne":6,"teamTwo":6,"tiebreakTeamOne":7,"tiebreakTeamTwo":5}]"""),
        )

        val viewModel = makeViewModel()
        viewModel.load("e1")
        advanceUntilIdle()
        viewModel.incrementScoreOne()
        advanceUntilIdle()

        assertEquals(1, viewModel.uiState.value.scoreOne)
        assertEquals(0, viewModel.uiState.value.scoreTwo)
    }

    @Test
    fun `incrementing a team two tiebreak winner updates match score`() = runTest {
        coEvery { repository.getGame("e1") } returns makeGame("e1").copy(sport = "padel")
        coEvery { repository.refreshHistory("e1") } returns Result.success(Unit)
        coEvery { repository.observeLatestHistoryForEvent("e1") } returns flowOf(
            makeHistory("h1", "e1", 0, 0, """[{"teamOne":6,"teamTwo":6,"tiebreakTeamOne":5,"tiebreakTeamTwo":7}]"""),
        )

        val viewModel = makeViewModel()
        viewModel.load("e1")
        advanceUntilIdle()
        viewModel.incrementScoreTwo()
        advanceUntilIdle()

        assertEquals(0, viewModel.uiState.value.scoreOne)
        assertEquals(1, viewModel.uiState.value.scoreTwo)
    }

    @Test
    fun `legacy scalar tennis history opens structured scoring without guessing sets`() = runTest {
        coEvery { repository.getGame("e1") } returns makeGame("e1").copy(sport = "tennis")
        coEvery { repository.refreshHistory("e1") } returns Result.success(Unit)
        coEvery { repository.observeLatestHistoryForEvent("e1") } returns flowOf(makeHistory("h1", "e1", 2, 1))

        val viewModel = makeViewModel()
        viewModel.load("e1")
        advanceUntilIdle()

        assertTrue(viewModel.uiState.value.isTennisScoring)
        assertEquals(2, viewModel.uiState.value.scoreOne)
        assertEquals(1, viewModel.uiState.value.scoreTwo)
        assertTrue(viewModel.uiState.value.scoreSets.isEmpty())
        assertEquals(2 to 1, viewModel.uiState.value.legacyScalarScore)

        viewModel.incrementScoreOne()
        advanceUntilIdle()

        assertEquals(1, viewModel.uiState.value.scoreSets.single().pointTeamOne)
        assertNull(viewModel.uiState.value.legacyScalarScore)
        assertEquals(0, viewModel.uiState.value.scoreSets.single().pointTeamTwo)
    }

    @Test
    fun `undoing the first point restores legacy scalar state and payload`() = runTest {
        coEvery { repository.getGame("e1") } returns makeGame("e1").copy(sport = "tennis")
        coEvery { repository.refreshHistory("e1") } returns Result.success(Unit)
        coEvery { repository.observeLatestHistoryForEvent("e1") } returns flowOf(makeHistory("h1", "e1", 2, 1))
        coEvery { scoreRepository.submitScore(any(), any(), any(), any(), any(), any(), any()) } returns Result.success(Unit)

        val viewModel = makeViewModel()
        viewModel.load("e1")
        advanceUntilIdle()
        viewModel.incrementScoreOne()
        advanceUntilIdle()
        viewModel.undoLastScore()
        advanceUntilIdle()

        assertEquals(2 to 1, viewModel.uiState.value.legacyScalarScore)
        assertTrue(viewModel.uiState.value.scoreSets.isEmpty())
        coVerify {
            scoreRepository.submitScore(
                eventId = "e1",
                historyId = "h1",
                scoreOne = 2,
                scoreTwo = 1,
                teamOneName = "Red",
                teamTwoName = "Blue",
                scoreSets = null,
            )
        }
    }

    @Test
    fun `legacy scalar history ignores decrement tiebreak and next-set before conversion`() = runTest {
        coEvery { repository.getGame("e1") } returns makeGame("e1").copy(sport = "tennis")
        coEvery { repository.refreshHistory("e1") } returns Result.success(Unit)
        coEvery { repository.observeLatestHistoryForEvent("e1") } returns flowOf(makeHistory("h1", "e1", 2, 1))

        val viewModel = makeViewModel()
        viewModel.load("e1")
        advanceUntilIdle()
        viewModel.decrementScoreOne()
        viewModel.toggleTiebreak()
        viewModel.advanceSet()

        assertEquals(2 to 1, viewModel.uiState.value.legacyScalarScore)
        assertTrue(viewModel.uiState.value.scoreSets.isEmpty())
        coVerify(exactly = 0) { scoreRepository.submitScore(any(), any(), any(), any(), any(), any(), any()) }
    }

    @Test
    fun `completed set ignores further point increments until a new set is added`() = runTest {
        coEvery { repository.getGame("e1") } returns makeGame("e1").copy(sport = "tennis")
        coEvery { repository.refreshHistory("e1") } returns Result.success(Unit)
        coEvery { repository.observeLatestHistoryForEvent("e1") } returns flowOf(
            makeHistory("h1", "e1", 1, 0, "[{\"teamOne\":6,\"teamTwo\":4,\"pointTeamOne\":0,\"pointTeamTwo\":0,\"pointGameActive\":false,\"pointGameCompletedBy\":1}]")
        )

        val viewModel = makeViewModel()
        viewModel.load("e1")
        advanceUntilIdle()
        val completedSet = viewModel.uiState.value.scoreSets.single()
        viewModel.incrementScoreOne()
        advanceUntilIdle()

        assertEquals(listOf(completedSet), viewModel.uiState.value.scoreSets)
    }

    @Test
    fun `structured tennis history edits the active game points`() = runTest {
        coEvery { repository.getGame("e1") } returns makeGame("e1").copy(sport = "padel")
        coEvery { repository.refreshHistory("e1") } returns Result.success(Unit)
        coEvery { repository.observeLatestHistoryForEvent("e1") } returns flowOf(
            makeHistory("h1", "e1", 0, 0, "[{\"teamOne\":3,\"teamTwo\":2,\"pointTeamOne\":2,\"pointTeamTwo\":3}]")
        )

        val viewModel = makeViewModel()
        viewModel.load("e1")
        advanceUntilIdle()
        viewModel.incrementScoreOne()
        advanceUntilIdle()

        val set = viewModel.uiState.value.scoreSets.single()
        assertEquals(3, set.pointTeamOne)
        assertEquals(3, set.pointTeamTwo)
    }

    @Test
    fun `adding a new set makes a previously final structured match incomplete`() = runTest {
        coEvery { repository.getGame("e1") } returns makeGame("e1").copy(sport = "tennis")
        coEvery { repository.refreshHistory("e1") } returns Result.success(Unit)
        coEvery { repository.observeLatestHistoryForEvent("e1") } returns flowOf(
            makeHistory("h1", "e1", 1, 0, """[{"teamOne":6,"teamTwo":4}]"""),
        )

        val viewModel = makeViewModel()
        viewModel.load("e1")
        advanceUntilIdle()
        assertTrue(viewModel.uiState.value.hasFinalScore)

        viewModel.advanceSet()

        assertFalse(viewModel.uiState.value.hasFinalScore)
    }

    @Test
    fun `incomplete structured score is not treated as final`() = runTest {
        coEvery { repository.getGame("e1") } returns makeGame("e1").copy(sport = "tennis")
        coEvery { repository.refreshHistory("e1") } returns Result.success(Unit)
        coEvery { repository.observeLatestHistoryForEvent("e1") } returns flowOf(
            makeHistory("h1", "e1", 0, 0, """[{"teamOne":1,"teamTwo":0}]"""),
        )

        val viewModel = makeViewModel()
        viewModel.load("e1")
        advanceUntilIdle()

        assertFalse(viewModel.uiState.value.hasFinalScore)
        assertEquals(0, viewModel.uiState.value.scoreOne)
        assertEquals(0, viewModel.uiState.value.scoreTwo)
    }

    @Test
    fun `structured match is final only when every recorded set is complete`() {
        assertFalse(hasCompletedMatch(listOf(dev.convocados.wear.data.api.SetScore(6, 4), dev.convocados.wear.data.api.SetScore(1, 0))))
        assertTrue(hasCompletedMatch(listOf(dev.convocados.wear.data.api.SetScore(6, 4), dev.convocados.wear.data.api.SetScore(7, 5))))
    }

    // ── Helpers ──────────────────────────────────────────────────────────

    private fun makeGame(id: String, time: Instant = Instant.now().minus(10, ChronoUnit.MINUTES)) = WearGameEntity(
        id = id,
        title = "Game $id",
        location = "Field",
        dateTime = time.atZone(ZoneOffset.UTC).format(DateTimeFormatter.ISO_DATE_TIME),
        sport = "Soccer",
        maxPlayers = 10,
        playerCount = 5,
        teamOneName = "Team 1",
        teamTwoName = "Team 2",
        isRecurring = false,
        archivedAt = null,
        type = "owned",
    )

    private fun makeHistory(id: String, eventId: String, scoreOne: Int, scoreTwo: Int, scoreSetsJson: String? = null) =
        WearHistoryEntity(
            id = id,
            eventId = eventId,
            dateTime = "2025-01-01T10:00:00Z",
            scoreOne = scoreOne,
            scoreTwo = scoreTwo,
            teamOneName = "Red",
            teamTwoName = "Blue",
            editable = true,
            scoreSetsJson = scoreSetsJson,
        )
}