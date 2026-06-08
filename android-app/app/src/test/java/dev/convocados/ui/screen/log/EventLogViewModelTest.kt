package dev.convocados.ui.screen.log

import dev.convocados.data.api.*
import io.mockk.coEvery
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.*
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class EventLogViewModelTest {
    private val api = mockk<ConvocadosApi>()
    private val testDispatcher = StandardTestDispatcher()

    @Before
    fun setup() { Dispatchers.setMain(testDispatcher) }

    @After
    fun tearDown() { Dispatchers.resetMain() }

    @Test
    fun `load fetches event log entries`() = runTest {
        val entries = listOf(
            EventLogEntry(id = "l1", action = "player_added", actor = "José", createdAt = "2024-01-01T10:00:00Z"),
            EventLogEntry(id = "l2", action = "teams_randomized", actor = "José", createdAt = "2024-01-01T10:05:00Z"),
        )
        coEvery { api.fetchEventLog("e1", null) } returns PaginatedLog(entries = entries, hasMore = false)

        val vm = EventLogViewModel(api)
        vm.load("e1")
        advanceUntilIdle()

        assertEquals(2, vm.entries.value.size)
        assertEquals("player_added", vm.entries.value[0].action)
        assertFalse(vm.loading.value)
        assertFalse(vm.hasMore.value)
    }

    @Test
    fun `loadMore appends entries`() = runTest {
        val page1 = listOf(EventLogEntry(id = "l1", action = "player_added", createdAt = "2024-01-01T10:00:00Z"))
        val page2 = listOf(EventLogEntry(id = "l2", action = "score_updated", createdAt = "2024-01-01T11:00:00Z"))
        coEvery { api.fetchEventLog("e1", null) } returns PaginatedLog(entries = page1, hasMore = true, nextCursor = "c1")
        coEvery { api.fetchEventLog("e1", "c1") } returns PaginatedLog(entries = page2, hasMore = false)

        val vm = EventLogViewModel(api)
        vm.load("e1")
        advanceUntilIdle()

        vm.loadMore("e1")
        advanceUntilIdle()

        assertEquals(2, vm.entries.value.size)
        assertFalse(vm.hasMore.value)
    }
}
