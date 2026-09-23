package dev.convocados.ui.screen.event

import app.cash.turbine.test
import dev.convocados.data.api.*
import dev.convocados.data.auth.TokenStore
import dev.convocados.data.repository.EventRepository
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class MatchEventsViewModelTest {
    private val repository = mockk<EventRepository>(relaxUnitFun = true)
    private val api = mockk<ConvocadosApi>(relaxed = true)
    private val tokenStore = mockk<TokenStore>(relaxed = true)
    private val client = mockk<ApiClient>(relaxed = true)
    private val settingsStore = mockk<dev.convocados.data.datastore.SettingsStore>(relaxed = true) {
        every { autoPayOnJoin } returns flowOf(false)
    }
    private val testDispatcher = StandardTestDispatcher()

    private val eventId = "e1"
    private val historyId = "h1"

    @Before
    fun setup() {
        Dispatchers.setMain(testDispatcher)
        coEvery { repository.refreshEventDetail(any()) } returns true
    }

    @After
    fun tearDown() = Dispatchers.resetMain()

    private fun viewModel() = EventDetailViewModel(repository, api, tokenStore, client, settingsStore)

    @Test
    fun `loadMatchEvents stores the timeline and clears the loading flag`() = runTest {
        val response = MatchEventsResponse(
            events = listOf(MatchEvent(id = "m1", type = "goal", team = "one", scorerName = "Alice")),
            score = MatchEventScore(teamOne = 1, teamTwo = 0),
        )
        coEvery { api.fetchMatchEvents(eventId, historyId) } returns response

        val vm = viewModel()
        vm.state.test {
            skipItems(1)
            vm.loadMatchEvents(eventId, historyId)
            advanceUntilIdle()
            val loaded = expectMostRecentItem()
            assertEquals(1, loaded.matchEvents?.events?.size)
            assertEquals(1, loaded.matchEvents?.score?.teamOne)
            assertFalse(loaded.matchEventsLoading)
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `addMatchEvent posts the goal and refreshes the timeline`() = runTest {
        val request = MatchEventRequest(type = "goal", team = "one", scorerName = "Alice")
        coEvery { api.addMatchEvent(eventId, historyId, request) } returns
            MatchEventResponse(ok = true, event = MatchEvent(id = "m1", scorerName = "Alice"))
        coEvery { api.fetchMatchEvents(eventId, historyId) } returns
            MatchEventsResponse(events = listOf(MatchEvent(id = "m1", scorerName = "Alice")))

        val vm = viewModel()
        vm.state.test {
            skipItems(1)
            vm.addMatchEvent(eventId, historyId, request)
            advanceUntilIdle()
            val after = expectMostRecentItem()
            assertEquals(1, after.matchEvents?.events?.size)
            assertFalse(after.matchEventsSaving)
            cancelAndIgnoreRemainingEvents()
        }
        coVerify { api.addMatchEvent(eventId, historyId, request) }
        coVerify { repository.refreshEventDetail(eventId) }
    }

    @Test
    fun `addMatchEvent surfaces the API error and clears the saving flag`() = runTest {
        val request = MatchEventRequest(type = "goal", team = "one", scorerName = "Alice")
        coEvery { api.addMatchEvent(eventId, historyId, request) } throws
            ApiException(400, """{"error":"Match events can only be logged on played games."}""")

        val vm = viewModel()
        vm.state.test {
            skipItems(1)
            vm.addMatchEvent(eventId, historyId, request)
            advanceUntilIdle()
            val after = expectMostRecentItem()
            assertFalse(after.matchEventsSaving)
            assertEquals("Match events can only be logged on played games.", after.error)
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `loadMatchEvents stops loading on failure`() = runTest {
        coEvery { api.fetchMatchEvents(eventId, historyId) } throws ApiException(500, "boom")

        val vm = viewModel()
        vm.state.test {
            skipItems(1)
            vm.loadMatchEvents(eventId, historyId)
            advanceUntilIdle()
            val after = expectMostRecentItem()
            assertFalse(after.matchEventsLoading)
            cancelAndIgnoreRemainingEvents()
        }
    }
}
