package dev.convocados.wear.ui.screen.quick

import dev.convocados.wear.data.alarm.GameAlarmScheduler
import dev.convocados.wear.data.api.displayTennisPoint
import dev.convocados.wear.data.api.tennisGameScore
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
        repeat(4) { repeat(4) { viewModel.incrementScoreTwo() } }
        repeat(6) { repeat(4) { viewModel.incrementScoreOne() } }

        assertEquals(1, state.value.scoreOne)
        assertEquals(0, state.value.scoreTwo)
        assertEquals(6, state.value.scoreSets.single().teamOne)
        assertEquals(4, state.value.scoreSets.single().teamTwo)
        viewModel.incrementScoreOne()
        assertEquals(6, state.value.scoreSets.single().teamOne)
        assertEquals(4, state.value.scoreSets.single().teamTwo)
    }

    @Test
    fun `tennis points support deuce advantage and game completion`() {
        val (viewModel, state) = viewModel()

        viewModel.startNew(60, 0, "tennis")
        repeat(3) { viewModel.incrementScoreOne() }
        repeat(3) { viewModel.incrementScoreTwo() }

        assertEquals(3, state.value.scoreSets.single().pointTeamOne)
        assertEquals(3, state.value.scoreSets.single().pointTeamTwo)
        assertEquals("Deuce", displayTennisPoint(state.value.scoreSets.single().tennisGameScore()))

        viewModel.incrementScoreOne()
        assertEquals(4, state.value.scoreSets.single().pointTeamOne)
        assertEquals(3, state.value.scoreSets.single().pointTeamTwo)
        viewModel.incrementScoreTwo()
        assertEquals(3, state.value.scoreSets.single().pointTeamOne)
        assertEquals(3, state.value.scoreSets.single().pointTeamTwo)

        viewModel.incrementScoreOne()
        viewModel.incrementScoreOne()
        val set = state.value.scoreSets.single()
        assertEquals(0, state.value.scoreOne)
        assertEquals(1, set.teamOne)
        assertEquals(0, set.teamTwo)
        assertEquals(0, set.pointTeamOne)
        assertEquals(0, set.pointTeamTwo)
        assertTrue(!set.pointGameActive)
    }

    @Test
    fun `padel uses the same point scoring before tiebreak mode`() {
        val (viewModel, state) = viewModel()

        viewModel.startNew(60, 0, "padel")
        repeat(3) { viewModel.incrementScoreOne() }
        repeat(2) { viewModel.incrementScoreTwo() }

        val set = state.value.scoreSets.single()
        assertEquals(3, set.pointTeamOne)
        assertEquals(2, set.pointTeamTwo)
        assertEquals(0, set.teamOne)
        assertEquals(0, set.teamTwo)
    }

    @Test
    fun `padel tiebreak scoring completes the active set`() {
        val (viewModel, state) = viewModel()

        viewModel.startNew(60, 0, "padel")
        repeat(6) {
            repeat(4) { viewModel.incrementScoreOne() }
            repeat(4) { viewModel.incrementScoreTwo() }
        }
        viewModel.toggleTiebreak()
        repeat(5) {
            viewModel.incrementScoreOne()
            viewModel.incrementScoreTwo()
        }
        viewModel.incrementScoreOne()
        viewModel.incrementScoreOne()

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
