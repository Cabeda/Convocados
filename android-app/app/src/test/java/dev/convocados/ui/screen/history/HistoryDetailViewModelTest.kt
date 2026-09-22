package dev.convocados.ui.screen.history

import app.cash.turbine.test
import dev.convocados.data.api.*
import dev.convocados.ui.components.MatchEventDraft
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.*
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class HistoryDetailViewModelTest {
    private val api = mockk<ConvocadosApi>()
    private val testDispatcher = StandardTestDispatcher()

    @Before
    fun setup() { Dispatchers.setMain(testDispatcher) }

    @After
    fun tearDown() { Dispatchers.resetMain() }

    @Test
    fun `load fetches history detail and parses teamsSnapshot`() = runTest {
        val history = GameHistory(
            id = "h1", dateTime = "2024-01-01T10:00:00Z", scoreOne = 3, scoreTwo = 2,
            teamOneName = "Ninjas", teamTwoName = "Gunas",
            teamsSnapshot = """[{"team":"Ninjas","players":[{"name":"Alice","order":0}]},{"team":"Gunas","players":[{"name":"Bob","order":0}]}]""",
        )
        coEvery { api.fetchHistoryDetail("e1", "h1") } returns history

        val vm = HistoryDetailViewModel(api)
        vm.load("e1", "h1")
        advanceUntilIdle()

        assertEquals(history, vm.history.value)
        assertEquals(1, vm.teamOne.value.size)
        assertEquals("Alice", vm.teamOne.value[0].name)
        assertEquals("Bob", vm.teamTwo.value[0].name)
    }

    @Test
    fun `updateScore calls API and updates state`() = runTest {
        val history = GameHistory(id = "h1", dateTime = "2024-01-01T10:00:00Z", scoreOne = 0, scoreTwo = 0)
        val updated = history.copy(scoreOne = 5, scoreTwo = 3)
        coEvery { api.fetchHistoryDetail("e1", "h1") } returns history
        coEvery { api.updateScore("e1", "h1", 5, 3) } returns updated

        val vm = HistoryDetailViewModel(api)
        vm.load("e1", "h1")
        advanceUntilIdle()

        vm.updateScore("e1", "h1", 5, 3)
        advanceUntilIdle()

        coVerify { api.updateScore("e1", "h1", 5, 3) }
        assertEquals(5, vm.history.value?.scoreOne)
        assertEquals(3, vm.history.value?.scoreTwo)
    }

    @Test
    fun `loadMatchEvents maps the timeline and marks it loaded`() = runTest {
        coEvery { api.fetchMatchEvents("e1", "h1") } returns MatchEventsResponse(
            events = listOf(
                MatchEvent(id = "m1", type = "goal", team = "one", scorerName = "Alice", assistName = "Bob", minute = 12),
            ),
        )

        val vm = HistoryDetailViewModel(api)
        vm.loadMatchEvents("e1", "h1")
        advanceUntilIdle()

        assertEquals(1, vm.matchEvents.value.size)
        assertEquals("Alice", vm.matchEvents.value[0].scorerName)
        assertEquals("Bob", vm.matchEvents.value[0].assistName)
        assertEquals(12, vm.matchEvents.value[0].minute)
        assertTrue(vm.matchEventsLoaded.value)
    }

    @Test
    fun `addMatchEvent posts the draft and refreshes the timeline`() = runTest {
        val draft = MatchEventDraft(
            scorerEventPlayerId = "ep1",
            scorerName = "Alice",
            team = "one",
            minute = 20,
            ownGoal = false,
            penalty = true,
        )
        coEvery { api.addMatchEvent("e1", "h1", any()) } returns MatchEventResponse(ok = true)
        coEvery { api.fetchMatchEvents("e1", "h1") } returns MatchEventsResponse(
            events = listOf(MatchEvent(id = "m1", scorerName = "Alice", penalty = true)),
        )

        val vm = HistoryDetailViewModel(api)
        vm.addMatchEvent("e1", "h1", draft)
        advanceUntilIdle()

        coVerify { api.addMatchEvent("e1", "h1", any()) }
        assertEquals(1, vm.matchEvents.value.size)
        assertFalse(vm.matchEventsSaving.value)
    }

    @Test
    fun `addMatchEvent surfaces the server error`() = runTest {
        val draft = MatchEventDraft("ep1", "Alice", "one", null, false, false)
        coEvery { api.addMatchEvent("e1", "h1", any()) } throws
            ApiException(400, """{"error":"Match events can only be logged on played games."}""")

        val vm = HistoryDetailViewModel(api)
        vm.addMatchEvent("e1", "h1", draft)
        advanceUntilIdle()

        assertEquals("Match events can only be logged on played games.", vm.error.value)
        assertFalse(vm.matchEventsSaving.value)
    }
}
