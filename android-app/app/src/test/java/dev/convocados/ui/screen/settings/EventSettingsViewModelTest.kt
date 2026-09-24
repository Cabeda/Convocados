package dev.convocados.ui.screen.settings

import dev.convocados.data.api.ApiException
import dev.convocados.data.api.CompetitionRequest
import dev.convocados.data.api.CompetitionResponse
import dev.convocados.data.api.ConvocadosApi
import dev.convocados.data.api.EventDetail
import dev.convocados.data.repository.EventRepository
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class EventSettingsViewModelTest {
    private val api = mockk<ConvocadosApi>(relaxed = true)
    private val repository = mockk<EventRepository>(relaxed = true)
    private val testDispatcher = StandardTestDispatcher()

    @Before
    fun setup() {
        Dispatchers.setMain(testDispatcher)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun event(
        eloEnabled: Boolean = true,
        rankEnabled: Boolean = true,
        rankDecayEnabled: Boolean = false,
        inactiveRankBehavior: String = "freeze",
    ) = EventDetail(
        id = "e1",
        title = "Match",
        dateTime = "2026-01-01T10:00:00Z",
        maxPlayers = 10,
        eloEnabled = eloEnabled,
        rankEnabled = rankEnabled,
        rankDecayEnabled = rankDecayEnabled,
        inactiveRankBehavior = inactiveRankBehavior,
    )

    private fun viewModel() = EventSettingsViewModel(api, repository)

    @Test
    fun `load populates event including competition settings`() = runTest {
        coEvery { api.fetchEvent("e1") } returns event(
            rankDecayEnabled = true,
            inactiveRankBehavior = "reset",
        )

        val viewModel = viewModel()
        viewModel.load("e1")
        advanceUntilIdle()

        val loaded = viewModel.event.value
        assertEquals("Match", loaded?.title)
        assertEquals(true, loaded?.rankEnabled)
        assertEquals(true, loaded?.rankDecayEnabled)
        assertEquals("reset", loaded?.inactiveRankBehavior)
        assertNull(viewModel.message.value)
    }

    @Test
    fun `toggleCompetition posts enabled payload then reloads`() = runTest {
        coEvery { api.fetchEvent("e1") } returns event()
        coEvery { api.updateCompetition("e1", any()) } returns CompetitionResponse()

        val viewModel = viewModel()
        viewModel.load("e1")
        advanceUntilIdle()

        viewModel.toggleCompetition("e1", false)
        advanceUntilIdle()

        coVerify { api.updateCompetition("e1", CompetitionRequest(enabled = false)) }
        coVerify(atLeast = 2) { api.fetchEvent("e1") }
        assertNull(viewModel.message.value)
    }

    @Test
    fun `toggleRankDecay posts rankDecayEnabled payload`() = runTest {
        coEvery { api.fetchEvent("e1") } returns event()
        coEvery { api.updateCompetition("e1", any()) } returns CompetitionResponse()

        val viewModel = viewModel()
        viewModel.load("e1")
        advanceUntilIdle()

        viewModel.toggleRankDecay("e1", true)
        advanceUntilIdle()

        coVerify { api.updateCompetition("e1", CompetitionRequest(rankDecayEnabled = true)) }
    }

    @Test
    fun `setInactiveRankBehavior posts behavior payload`() = runTest {
        coEvery { api.fetchEvent("e1") } returns event()
        coEvery { api.updateCompetition("e1", any()) } returns CompetitionResponse()

        val viewModel = viewModel()
        viewModel.load("e1")
        advanceUntilIdle()

        viewModel.setInactiveRankBehavior("e1", "reset")
        advanceUntilIdle()

        coVerify { api.updateCompetition("e1", CompetitionRequest(inactiveRankBehavior = "reset")) }
    }

    @Test
    fun `competition lock 409 surfaces the server message`() = runTest {
        coEvery { api.fetchEvent("e1") } returns event()
        coEvery { api.updateCompetition("e1", any()) } throws
            ApiException(409, "Competitive settings are locked while a Season is active.")

        val viewModel = viewModel()
        viewModel.load("e1")
        advanceUntilIdle()

        viewModel.toggleCompetition("e1", true)
        advanceUntilIdle()

        assertEquals(
            "Competitive settings are locked while a Season is active.",
            viewModel.message.value,
        )

        viewModel.clearMessage()
        assertNull(viewModel.message.value)
    }
}
