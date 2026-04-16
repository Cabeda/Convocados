package dev.convocados.wear.ui.screen.score

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.work.WorkManager
import dagger.hilt.android.lifecycle.HiltViewModel
import dev.convocados.wear.data.local.entity.WearGameEntity
import dev.convocados.wear.data.local.entity.WearHistoryEntity
import dev.convocados.wear.data.repository.WearGameRepository
import dev.convocados.wear.data.sync.ScoreSyncWorker
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
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
    val isSyncing: Boolean = false,
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
    private var autoSaveJob: Job? = null

    companion object {
        private const val AUTO_SAVE_DELAY_MS = 1000L
    }

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
                        isLoading = false,
                    )
                }
            }
        }
    }

    /**
     * Increment or decrement a team's score.
     * Auto-saves after a 1s debounce — no manual save needed.
     */
    fun updateScore(team: Team, delta: Int) {
        _uiState.update {
            when (team) {
                Team.ONE -> it.copy(scoreOne = maxOf(0, it.scoreOne + delta))
                Team.TWO -> it.copy(scoreTwo = maxOf(0, it.scoreTwo + delta))
            }
        }
        scheduleAutoSave()
    }

    private fun scheduleAutoSave() {
        autoSaveJob?.cancel()
        autoSaveJob = viewModelScope.launch {
            delay(AUTO_SAVE_DELAY_MS)
            persistScore()
        }
    }

    private suspend fun persistScore() {
        val state = _uiState.value
        val historyId = state.history?.id ?: return

        _uiState.update { it.copy(isSyncing = true, error = null) }

        repository.submitScore(
            eventId = eventId,
            historyId = historyId,
            scoreOne = state.scoreOne,
            scoreTwo = state.scoreTwo,
            teamOneName = state.teamOneName,
            teamTwoName = state.teamTwoName,
        )

        ScoreSyncWorker.enqueueOneTime(workManager)

        _uiState.update { it.copy(isSyncing = false) }
    }
}
