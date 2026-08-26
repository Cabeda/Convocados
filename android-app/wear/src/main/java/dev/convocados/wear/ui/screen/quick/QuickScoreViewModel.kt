package dev.convocados.wear.ui.screen.quick

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import dev.convocados.wear.data.alarm.AlarmFire
import dev.convocados.wear.data.alarm.GameAlarmScheduler
import dev.convocados.wear.data.local.QuickGameState
import dev.convocados.wear.data.local.QuickGameStore
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

typealias QuickScoreUiState = QuickGameState

private const val QUICK_EVENT_ID = "quick-game"

@HiltViewModel
class QuickScoreViewModel @Inject constructor(
    private val quickGameStore: QuickGameStore,
    private val alarmScheduler: GameAlarmScheduler,
) : ViewModel() {

    val uiState: StateFlow<QuickScoreUiState> = quickGameStore.state
        .stateIn(viewModelScope, SharingStarted.Eagerly, quickGameStore.state.value)

    /** Start a brand-new quick game: kickoff anchored to now, score reset. */
    fun startNew(durationMinutes: Int, alarmIntervalMinutes: Int) {
        applyAndSchedule { it.copy(
            scoreOne = 0,
            scoreTwo = 0,
            durationMinutes = durationMinutes,
            alarmIntervalMinutes = alarmIntervalMinutes,
            kickoffEpochMs = System.currentTimeMillis(),
        ) }
    }

    /** Restart the current quick game: same config, fresh timer, score reset. */
    fun restart() {
        applyAndSchedule { it.copy(
            scoreOne = 0,
            scoreTwo = 0,
            kickoffEpochMs = System.currentTimeMillis(),
        ) }
    }

    /** Resume a persisted quick game — timer stays anchored to the original kickoff. */
    fun continueGame() {
        val s = quickGameStore.state.value.kickoffEpochMs ?: return
        scheduleAlarms(s, quickGameStore.state.value.durationMinutes, quickGameStore.state.value.alarmIntervalMinutes)
    }

    fun endGame() {
        alarmScheduler.cancelAll(QUICK_EVENT_ID)
        quickGameStore.clear()
    }

    fun incrementScoreOne() = updateScore { it.copy(scoreOne = it.scoreOne + 1) }

    fun decrementScoreOne() = updateScore { it.copy(scoreOne = maxOf(0, it.scoreOne - 1)) }

    fun incrementScoreTwo() = updateScore { it.copy(scoreTwo = it.scoreTwo + 1) }

    fun decrementScoreTwo() = updateScore { it.copy(scoreTwo = maxOf(0, it.scoreTwo - 1)) }

    private fun updateScore(transform: (QuickGameState) -> QuickGameState) {
        quickGameStore.update(transform)
    }

    private fun applyAndSchedule(transform: (QuickGameState) -> QuickGameState) {
        val updated = quickGameStore.state.value.let(transform)
        quickGameStore.update { updated }
        scheduleAlarms(updated.kickoffEpochMs ?: System.currentTimeMillis(), updated.durationMinutes, updated.alarmIntervalMinutes)
    }

    private fun scheduleAlarms(kickoffMs: Long, durationMinutes: Int, intervalMinutes: Int) {
        if (intervalMinutes <= 0) {
            alarmScheduler.cancelAll(QUICK_EVENT_ID)
            return
        }
        val endMs = kickoffMs + durationMinutes * 60_000L
        val fires = mutableListOf<AlarmFire>()
        var k = 1
        while (true) {
            val t = kickoffMs + k.toLong() * intervalMinutes * 60_000L
            if (t > endMs) break
            fires += AlarmFire(t, pulses = 2)
            k++
        }
        alarmScheduler.reschedule(QUICK_EVENT_ID, fires)
    }

    // NOTE: no onCleared alarm cancellation — the quick game is durable and
    // may still be live after the user leaves. Alarms are only cancelled on
    // endGame() (or they naturally stop at the game end).
}