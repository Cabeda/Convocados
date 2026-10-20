package dev.convocados.wear.ui.screen.teams

import dev.convocados.wear.data.api.KnownPlayer
import dev.convocados.wear.data.api.KnownPlayersResponse
import dev.convocados.wear.data.api.WearApiClient
import dev.convocados.wear.data.local.KnownPlayersStore
import dev.convocados.wear.data.repository.AddPlayerOutcome
import androidx.work.WorkManager
import dev.convocados.wear.data.repository.WearTeamRepository
import io.mockk.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.*
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import java.io.IOException

@OptIn(ExperimentalCoroutinesApi::class)
class AddPlayerViewModelTest {

    private val client = mockk<WearApiClient>()
    private val repository = mockk<WearTeamRepository>(relaxed = true)
    private val store = mockk<KnownPlayersStore>(relaxed = true)
    private val workManager = mockk<WorkManager>(relaxed = true)
    private val testDispatcher = StandardTestDispatcher()

    @Before
    fun setup() {
        Dispatchers.setMain(testDispatcher)
        every { repository.observeSignInRequired(any()) } returns flowOf(false)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun makeViewModel() = AddPlayerViewModel(client, repository, store, workManager)

    @Test
    fun `load falls back to the cached list when the network fails`() = runTest {
        val cached = listOf(KnownPlayer("Alice"))
        every { store.load("e1") } returns cached
        coEvery { repository.observePendingAddNames("e1") } returns MutableStateFlow(emptyList())
        coEvery { client.get<KnownPlayersResponse>(any()) } throws IOException("Offline")

        val viewModel = makeViewModel()
        viewModel.load("e1")
        advanceUntilIdle()

        val state = viewModel.uiState.value
        assertEquals(cached, state.known)
        assertFalse(state.isLoading)
        assertNull(state.error)
    }

    @Test
    fun `add keeps a queued name listed and marks it queued`() = runTest {
        val cached = listOf(KnownPlayer("Alice"))
        val queued = MutableStateFlow<List<String>>(emptyList())
        every { store.load("e1") } returns cached
        coEvery { repository.observePendingAddNames("e1") } returns queued
        coEvery { client.get<KnownPlayersResponse>(any()) } throws IOException("Offline")
        coEvery { repository.addPlayer("e1", "Alice") } returns Result.success(AddPlayerOutcome.QUEUED)

        val viewModel = makeViewModel()
        viewModel.load("e1")
        advanceUntilIdle()
        viewModel.add("e1", "Alice")
        advanceUntilIdle()
        queued.value = listOf("Alice")
        advanceUntilIdle()

        assertEquals(setOf("Alice"), viewModel.uiState.value.queuedNames)
        assertTrue(viewModel.uiState.value.known.any { it.name == "Alice" })
    }

    @Test
    fun `a queued add with an expired session asks for a sign-in`() = runTest {
        coEvery { repository.addPlayer("e1", "Alice") } returns
            Result.success(AddPlayerOutcome.QUEUED_SIGN_IN_REQUIRED)

        val viewModel = makeViewModel()
        viewModel.load("e1")
        advanceUntilIdle()
        viewModel.add("e1", "Alice")
        advanceUntilIdle()

        assertTrue(viewModel.uiState.value.signInRequired)
    }

    @Test
    fun `add removes the name when the server accepted it`() = runTest {
        every { store.load("e1") } returns listOf(KnownPlayer("Alice"))
        coEvery { repository.observePendingAddNames("e1") } returns MutableStateFlow(emptyList())
        coEvery { client.get<KnownPlayersResponse>(any()) } throws IOException("Offline")
        coEvery { repository.addPlayer("e1", "Alice") } returns Result.success(AddPlayerOutcome.ADDED)

        val viewModel = makeViewModel()
        viewModel.load("e1")
        advanceUntilIdle()
        viewModel.add("e1", "Alice")
        advanceUntilIdle()

        assertTrue(viewModel.uiState.value.known.none { it.name == "Alice" })
    }
}
