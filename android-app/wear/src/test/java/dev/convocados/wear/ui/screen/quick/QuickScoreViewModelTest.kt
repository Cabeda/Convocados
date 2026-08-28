package dev.convocados.wear.ui.screen.quick

import dev.convocados.wear.data.alarm.GameAlarmScheduler
import dev.convocados.wear.data.local.QuickGameState
import dev.convocados.wear.data.local.QuickGameStore
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.flow.MutableStateFlow
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class QuickScoreViewModelTest {

    private fun viewModel(initial: QuickGameState = QuickGameState()): Pair<QuickScoreViewModel, MutableStateFlow<QuickGameState>> {
        val state = MutableStateFlow(initial)
        val store = mockk<QuickGameStore>()
        every { store.state } returns state
        every { store.update(any()) } answers {
            @Suppress("UNCHECKED_CAST")
            val transform = invocation.args[0] as (QuickGameState) -> QuickGameState
            state.value = transform(state.value)
        }
        val scheduler = mockk<GameAlarmScheduler>(relaxed = true)
        return QuickScoreViewModel(store, scheduler) to state
    }

    @Test
    fun `new quick games default to standard scalar scoring`() {
        val (viewModel, state) = viewModel()

        viewModel.startNew(60, 0)
        viewModel.incrementScoreOne()
        viewModel.incrementScoreTwo()

        assertEquals("standard", state.value.sport)
        assertEquals(1, state.value.scoreOne)
        assertEquals(1, state.value.scoreTwo)
        assertTrue(state.value.scoreSets.isEmpty())
    }

    @Test
    fun `tennis score tracks completed sets and match wins`() {
        val (viewModel, state) = viewModel()

        viewModel.startNew(60, 0, "tennis")
        repeat(6) { viewModel.incrementScoreOne() }
        repeat(4) { viewModel.incrementScoreTwo() }

        assertEquals(1, state.value.scoreOne)
        assertEquals(0, state.value.scoreTwo)
        assertEquals(6, state.value.scoreSets.single().teamOne)
        assertEquals(4, state.value.scoreSets.single().teamTwo)
    }

    @Test
    fun `padel tiebreak scoring completes the active set`() {
        val (viewModel, state) = viewModel()

        viewModel.startNew(60, 0, "padel")
        repeat(6) {
            viewModel.incrementScoreOne()
            viewModel.incrementScoreTwo()
        }
        viewModel.toggleTiebreak()
        repeat(7) { viewModel.incrementScoreOne() }
        repeat(5) { viewModel.incrementScoreTwo() }

        val set = state.value.scoreSets.single()
        assertEquals(1, state.value.scoreOne)
        assertEquals(0, state.value.scoreTwo)
        assertEquals(7, set.tiebreakTeamOne)
        assertEquals(5, set.tiebreakTeamTwo)
    }

    @Test
    fun `restart clears structured score but keeps selected sport`() {
        val (viewModel, state) = viewModel()

        viewModel.startNew(60, 0, "tennis")
        repeat(6) { viewModel.incrementScoreOne() }
        viewModel.restart()

        assertEquals("tennis", state.value.sport)
        assertEquals(0, state.value.scoreOne)
        assertEquals(0, state.value.scoreTwo)
        assertTrue(state.value.scoreSets.isEmpty())
    }
}
