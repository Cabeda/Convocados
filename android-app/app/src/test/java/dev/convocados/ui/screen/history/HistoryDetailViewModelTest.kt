package dev.convocados.ui.screen.history

import app.cash.turbine.test
import dev.convocados.data.api.*
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
    fun `load finds history entry and parses teamsSnapshot`() = runTest {
        val history = GameHistory(
            id = "h1", dateTime = "2024-01-01T10:00:00Z", scoreOne = 3, scoreTwo = 2,
            teamOneName = "Ninjas", teamTwoName = "Gunas",
            teamsSnapshot = """{"teamOne":[{"id":"p1","name":"Alice"}],"teamTwo":[{"id":"p2","name":"Bob"}]}""",
        )
        coEvery { api.fetchHistory("e1", null) } returns PaginatedHistory(data = listOf(history))

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
        val history = GameHistory(id = "h1", dateTime = "2024-01-01T10:00:00Z", scoreOne = 0, scoreTwo = 0, editable = true)
        val updated = history.copy(scoreOne = 5, scoreTwo = 3)
        coEvery { api.fetchHistory("e1", null) } returns PaginatedHistory(data = listOf(history))
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
}
