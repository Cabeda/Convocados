package dev.convocados.wear.ui.screen.quick

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import javax.inject.Inject

data class QuickScoreUiState(
    val scoreOne: Int = 0,
    val scoreTwo: Int = 0,
    val durationMinutes: Int = 10,
    val periods: Int = 2,
    val kickoffEpochMs: Long = System.currentTimeMillis(),
)

@HiltViewModel
class QuickScoreViewModel @Inject constructor(
    private val savedState: SavedStateHandle,
) : ViewModel() {

    private val _uiState = MutableStateFlow(
        QuickScoreUiState(
            scoreOne = savedState["scoreOne"] ?: 0,
            scoreTwo = savedState["scoreTwo"] ?: 0,
            durationMinutes = savedState["duration"] ?: 10,
            periods = savedState["periods"] ?: 2,
            kickoffEpochMs = savedState["kickoff"] ?: System.currentTimeMillis(),
        )
    )
    val uiState: StateFlow<QuickScoreUiState> = _uiState.asStateFlow()

    fun configure(durationMinutes: Int, periods: Int) {
        val kickoff = System.currentTimeMillis()
        _uiState.update { it.copy(durationMinutes = durationMinutes, periods = periods, kickoffEpochMs = kickoff) }
        savedState["duration"] = durationMinutes
        savedState["periods"] = periods
        savedState["kickoff"] = kickoff
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
