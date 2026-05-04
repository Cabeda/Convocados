package dev.convocados.wear.ui.screen.score

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.work.WorkManager
import dagger.hilt.android.lifecycle.HiltViewModel
import dev.convocados.wear.data.local.entity.WearGameEntity
import dev.convocados.wear.data.local.entity.WearHistoryEntity
import dev.convocados.wear.data.repository.WearGameRepository
import dev.convocados.wear.data.sync.ScoreSyncWorker
import dev.convocados.wear.util.canScoreGame
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject

/** Which team's score to change. */
enum class Team { ONE, TWO }

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
    val isOfflineQueued: Boolean = false,
    val canScore: Boolean = false,
    val error: String? = null,
)

@HiltViewModel
class ScoreViewModel @Inject constructor(
    private val repository: WearGameRepository,
    private val workManager: WorkManager,
) : ViewModel() {

    private val _uiState = MutableStateFlow(ScoreUiState())
    val uiState: StateFlow<ScoreUiState> = _uiState.asStateFlow()

    private var eventId: String = ""

    fun load(eventId: String) {
        if (this.eventId == eventId) return
        this.eventId = eventId

        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }

            val game = repository.getGame(eventId)
            repository.refreshHistory(eventId)

            repository.observeLatestHistory(eventId).collect { history ->
                _uiState.update { state ->
                    state.copy(
                        game = game,
                        history = history,
                        scoreOne = history?.scoreOne ?: state.scoreOne,
                        scoreTwo = history?.scoreTwo ?: state.scoreTwo,
                        teamOneName = history?.teamOneName ?: game?.teamOneName ?: "Team 1",
                        teamTwoName = history?.teamTwoName ?: game?.teamTwoName ?: "Team 2",
                        canScore = game?.let { canScoreGame(it.dateTime) } ?: false,
                        isLoading = false,
                    )
                }
            }
        }
    }

    fun incrementScoreOne() {
        _uiState.update { it.copy(scoreOne = it.scoreOne + 1) }
    }

    fun decrementScoreOne() {
        _uiState.update { it.copy(scoreOne = maxOf(0, it.scoreOne - 1)) }
    }

    fun incrementScoreTwo() {
        _uiState.update { it.copy(scoreTwo = it.scoreTwo + 1) }
    }

    fun decrementScoreTwo() {
        _uiState.update { it.copy(scoreTwo = maxOf(0, it.scoreTwo - 1)) }
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

            ScoreSyncWorker.enqueueOneTime(workManager)

            _uiState.update {
                it.copy(
                    isSaving = false,
                    saved = true,
                    isOfflineQueued = result.isFailure,
                )
            }
        }
    }
}
