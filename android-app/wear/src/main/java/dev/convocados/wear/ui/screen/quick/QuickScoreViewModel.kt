package dev.convocados.wear.ui.screen.quick

import androidx.compose.runtime.Stable
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import dagger.hilt.android.lifecycle.HiltViewModel
import dev.convocados.wear.data.alarm.AlarmFire
import dev.convocados.wear.data.alarm.GameAlarmScheduler
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import javax.inject.Inject

@Stable
data class QuickScoreUiState(
    val scoreOne: Int = 0,
    val scoreTwo: Int = 0,
    val durationMinutes: Int = 60,
    val alarmIntervalMinutes: Int = 10,
    val kickoffEpochMs: Long = System.currentTimeMillis(),
)

private const val QUICK_EVENT_ID = "quick-game"

@HiltViewModel
class QuickScoreViewModel @Inject constructor(
    private val savedState: SavedStateHandle,
    private val alarmScheduler: GameAlarmScheduler,
) : ViewModel() {

    private val _uiState = MutableStateFlow(
        QuickScoreUiState(
            scoreOne = savedState["scoreOne"] ?: 0,
            scoreTwo = savedState["scoreTwo"] ?: 0,
            durationMinutes = savedState["duration"] ?: 60,
            alarmIntervalMinutes = savedState["alarmInterval"] ?: 10,
            kickoffEpochMs = savedState["kickoff"] ?: System.currentTimeMillis(),
        )
    )
    val uiState: StateFlow<QuickScoreUiState> = _uiState.asStateFlow()

    fun configure(durationMinutes: Int, alarmIntervalMinutes: Int) {
        val kickoff = System.currentTimeMillis()
        _uiState.update { it.copy(durationMinutes = durationMinutes, alarmIntervalMinutes = alarmIntervalMinutes, kickoffEpochMs = kickoff) }
        savedState["duration"] = durationMinutes
        savedState["alarmInterval"] = alarmIntervalMinutes
        savedState["kickoff"] = kickoff
        scheduleAlarms(kickoff, durationMinutes, alarmIntervalMinutes)
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

    override fun onCleared() {
        alarmScheduler.cancelAll(QUICK_EVENT_ID)
    }

    fun incrementScoreOne() {
        _uiState.update { it.copy(scoreOne = it.scoreOne + 1) }
        savedState["scoreOne"] = _uiState.value.scoreOne
    }

    fun decrementScoreOne() {
        _uiState.update { it.copy(scoreOne = maxOf(0, it.scoreOne - 1)) }
        savedState["scoreOne"] = _uiState.value.scoreOne
    }

    fun incrementScoreTwo() {
        _uiState.update { it.copy(scoreTwo = it.scoreTwo + 1) }
        savedState["scoreTwo"] = _uiState.value.scoreTwo
    }

    fun decrementScoreTwo() {
        _uiState.update { it.copy(scoreTwo = maxOf(0, it.scoreTwo - 1)) }
        savedState["scoreTwo"] = _uiState.value.scoreTwo
    }
}
