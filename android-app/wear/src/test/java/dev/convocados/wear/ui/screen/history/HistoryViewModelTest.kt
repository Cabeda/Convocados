package dev.convocados.wear.ui.screen.history

import dev.convocados.wear.data.local.entity.WearHistoryEntity
import dev.convocados.wear.data.repository.WearGameRepository
import io.mockk.coEvery
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
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class HistoryViewModelTest {

    private val repository = mockk<WearGameRepository>()
    private val testDispatcher = StandardTestDispatcher()

    @Before
    fun setup() {
        Dispatchers.setMain(testDispatcher)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun `history rows retain event and history identities for navigation`() = runTest {
        coEvery { repository.gameTitles() } returns mapOf("event-1" to "Game")
        every { repository.observeAllHistory() } returns flowOf(
            listOf(
                WearHistoryEntity(
                    id = "history-1",
                    eventId = "event-1",
                    dateTime = "2026-08-28T10:00:00Z",
                    scoreOne = 3,
                    scoreTwo = 2,
                    teamOneName = "One",
                    teamTwoName = "Two",
                    editable = false,
                ),
            ),
        )

        val viewModel = HistoryViewModel(repository)
        advanceUntilIdle()

        val row = viewModel.uiState.value.rows.single()
        assertEquals("event-1", row.eventId)
        assertEquals("history-1", row.historyId)
        assertEquals("Game", row.title)
    }
}
