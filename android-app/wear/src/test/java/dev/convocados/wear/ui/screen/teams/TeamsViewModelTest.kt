package dev.convocados.wear.ui.screen.teams

import app.cash.turbine.test
import dev.convocados.wear.data.api.TeamInfo
import dev.convocados.wear.data.api.TeamsResponse
import dev.convocados.wear.data.local.entity.WearPlayerEntity
import dev.convocados.wear.data.repository.WearGameRepository
import androidx.work.WorkManager
import io.mockk.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.*
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class TeamsViewModelTest {

    private val repository = mockk<WearGameRepository>(relaxed = true)
    private val workManager = mockk<WorkManager>(relaxed = true)
    private val testDispatcher = StandardTestDispatcher()

    private lateinit var viewModel: TeamsViewModel

    private val samplePlayers = listOf(
        WearPlayerEntity("p1", "event1", "Alice", 0, "teamOne"),
        WearPlayerEntity("p2", "event1", "Bob", 1, "teamTwo"),
        WearPlayerEntity("p3", "event1", "Charlie", 2, "unassigned"),
    )

    @Before
    fun setup() {
        Dispatchers.setMain(testDispatcher)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun `load calls refreshTeams and populates state from player flow`() = runTest {
        coEvery { repository.refreshTeams("event1") } returns Result.success(
            TeamsResponse(TeamInfo("Red", emptyList()), TeamInfo("Blue", emptyList()), emptyList(), emptyList(), 5)
        )
        every { repository.observePlayers("event1") } returns flowOf(samplePlayers)

        viewModel = TeamsViewModel(repository, workManager)
        viewModel.load("event1")
        advanceUntilIdle()

        viewModel.uiState.test {
            val state = awaitItem()
            assertFalse(state.isLoading)
            assertEquals(1, state.teamOnePlayers.size)
            assertEquals("Alice", state.teamOnePlayers[0].name)
            assertEquals(1, state.teamTwoPlayers.size)
            assertEquals("Bob", state.teamTwoPlayers[0].name)
            assertEquals(1, state.unassigned.size)
            assertEquals("Charlie", state.unassigned[0].name)
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `movePlayerToTeamOne calls repository with updated rosters`() = runTest {
        coEvery { repository.refreshTeams(any()) } returns Result.success(
            TeamsResponse(TeamInfo("Red", emptyList()), TeamInfo("Blue", emptyList()), emptyList(), emptyList(), 5)
        )
        every { repository.observePlayers("event1") } returns flowOf(samplePlayers)
        coEvery { repository.updateTeams(any(), any(), any()) } returns Result.success(Unit)

        viewModel = TeamsViewModel(repository, workManager)
        viewModel.load("event1")
        advanceUntilIdle()

        viewModel.movePlayerToTeamOne(samplePlayers[2]) // Charlie -> teamOne
        advanceUntilIdle()

        coVerify { repository.updateTeams("event1", listOf("p1", "p3"), listOf("p2")) }
    }

    @Test
    fun `movePlayerToTeamTwo calls repository with updated rosters`() = runTest {
        coEvery { repository.refreshTeams(any()) } returns Result.success(
            TeamsResponse(TeamInfo("Red", emptyList()), TeamInfo("Blue", emptyList()), emptyList(), emptyList(), 5)
        )
        every { repository.observePlayers("event1") } returns flowOf(samplePlayers)
        coEvery { repository.updateTeams(any(), any(), any()) } returns Result.success(Unit)

        viewModel = TeamsViewModel(repository, workManager)
        viewModel.load("event1")
        advanceUntilIdle()

        viewModel.movePlayerToTeamTwo(samplePlayers[2]) // Charlie -> teamTwo
        advanceUntilIdle()

        coVerify { repository.updateTeams("event1", listOf("p1"), listOf("p2", "p3")) }
    }

    @Test
    fun `movePlayerToUnassigned calls repository without that player`() = runTest {
        coEvery { repository.refreshTeams(any()) } returns Result.success(
            TeamsResponse(TeamInfo("Red", emptyList()), TeamInfo("Blue", emptyList()), emptyList(), emptyList(), 5)
        )
        every { repository.observePlayers("event1") } returns flowOf(samplePlayers)
        coEvery { repository.updateTeams(any(), any(), any()) } returns Result.success(Unit)

        viewModel = TeamsViewModel(repository, workManager)
        viewModel.load("event1")
        advanceUntilIdle()

        viewModel.movePlayerToUnassigned(samplePlayers[0]) // Alice off teamOne
        advanceUntilIdle()

        coVerify { repository.updateTeams("event1", emptyList(), listOf("p2")) }
    }

    @Test
    fun `movePlayer sets saved on success`() = runTest {
        coEvery { repository.refreshTeams(any()) } returns Result.success(
            TeamsResponse(TeamInfo("Red", emptyList()), TeamInfo("Blue", emptyList()), emptyList(), emptyList(), 5)
        )
        every { repository.observePlayers("event1") } returns flowOf(samplePlayers)
        coEvery { repository.updateTeams(any(), any(), any()) } returns Result.success(Unit)

        viewModel = TeamsViewModel(repository, workManager)
        viewModel.load("event1")
        advanceUntilIdle()

        viewModel.movePlayerToTeamOne(samplePlayers[2])
        advanceUntilIdle()

        assertTrue(viewModel.uiState.value.saved)
    }

    @Test
    fun `bench players appear in bench list`() = runTest {
        val playersWithBench = listOf(
            WearPlayerEntity("p1", "event1", "Alice", 0, "teamOne"),
            WearPlayerEntity("p2", "event1", "Bob", 1, "teamTwo"),
            WearPlayerEntity("p3", "event1", "Charlie", 2, "bench"),
        )
        coEvery { repository.refreshTeams(any()) } returns Result.success(
            TeamsResponse(TeamInfo("Red", emptyList()), TeamInfo("Blue", emptyList()), emptyList(), emptyList(), 5)
        )
        every { repository.observePlayers("event1") } returns flowOf(playersWithBench)

        viewModel = TeamsViewModel(repository, workManager)
        viewModel.load("event1")
        advanceUntilIdle()

        viewModel.uiState.test {
            val state = awaitItem()
            assertEquals(0, state.unassigned.size)
            assertEquals(1, state.bench.size)
            assertEquals("Charlie", state.bench[0].name)
            cancelAndIgnoreRemainingEvents()
        }
    }
}