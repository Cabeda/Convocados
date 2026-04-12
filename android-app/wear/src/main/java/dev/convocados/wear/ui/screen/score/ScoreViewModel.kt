package dev.convocados.wear.ui.screen.score

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import dev.convocados.wear.data.local.entity.WearGameEntity
import dev.convocados.wear.data.local.entity.WearHistoryEntity
import dev.convocados.wear.data.repository.WearGameRepository
import dev.convocados.wear.data.sync.ScoreSyncWorker
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject

data class ScoreUiState(
    val game: WearGameEntity? = null,
    val history: WearHistoryEntity? = null,
    val scoreOne: Int = 0,
    val scoreTwo: Int = 0,
    val teamOneName: String = "Team 1",
    val teamTwoName: String = "Team 2",
    val isLoading: Boolean = true,
    val isSaving: Boolean = false,
    val saved: Boolean = false,
    val error: String? = null,
    val isOfflineQueued: Boolean = false,
)

@HiltViewModel
class ScoreViewModel @Inject constructor(
    private val application: Application,
    private val repository: WearGameRepository,
) : AndroidViewModel(application) {

    private val _uiState = MutableStateFlow(ScoreUiState())
    val uiState: StateFlow<ScoreUiState> = _uiState.asStateFlow()

    private var eventId: String = ""

    fun load(eventId: String) {
        if (this.eventId == eventId) return
        this.eventId = eventId

        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }

            // Load cached game info
            val game = repository.getGame(eventId)

            // Try to refresh history from API
            repository.refreshHistory(eventId)

            // Observe latest history
            repository.observeLatestHistory(eventId).collect { history ->
                _uiState.update { state ->
                    state.copy(
                        game = game,
                        history = history,
                        scoreOne = history?.scoreOne ?: state.scoreOne,
                        scoreTwo = history?.scoreTwo ?: state.scoreTwo,
                        teamOneName = history?.teamOneName ?: game?.teamOneName ?: "Team 1",
                        teamTwoName = history?.teamTwoName ?: game?.teamTwoName ?: "Team 2",
                        isLoading = false,
                    )
                }
            }
        }
    }

    fun incrementScoreOne() {
        _uiState.update { it.copy(scoreOne = it.scoreOne + 1, saved = false) }
    }

    fun decrementScoreOne() {
        _uiState.update { it.copy(scoreOne = maxOf(0, it.scoreOne - 1), saved = false) }
    }

    fun incrementScoreTwo() {
        _uiState.update { it.copy(scoreTwo = it.scoreTwo + 1, saved = false) }
    }

    fun decrementScoreTwo() {
        _uiState.update { it.copy(scoreTwo = maxOf(0, it.scoreTwo - 1), saved = false) }
    }

    fun saveScore() {
        val state = _uiState.value
        val historyId = state.history?.id ?: return

        viewModelScope.launch {
            _uiState.update { it.copy(isSaving = true, error = null) }

            val result = repository.submitScore(
                eventId = eventId,
                historyId = historyId,
                scoreOne = state.scoreOne,
                scoreTwo = state.scoreTwo,
                teamOneName = state.teamOneName,
                teamTwoName = state.teamTwoName,
            )

            // Trigger sync worker in case it was queued offline
            ScoreSyncWorker.enqueueOneTime(application)

            _uiState.update {
                it.copy(
                    isSaving = false,
                    saved = true,
                    // If the repo caught an exception but queued it, it returns success
                    // We detect offline queueing by checking if pending count increased
                    isOfflineQueued = false, // Will be updated by observation
                )
            }
        }
    }
}
