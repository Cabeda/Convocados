package dev.convocados.wear.ui.screen.score

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.work.WorkManager
import dagger.hilt.android.lifecycle.HiltViewModel
import dev.convocados.wear.data.local.entity.WearGameEntity
import dev.convocados.wear.data.local.entity.WearHistoryEntity
import dev.convocados.wear.data.repository.WearGameRepository
import dev.convocados.wear.data.repository.WearScoreRepository
import dev.convocados.wear.data.sync.ScoreSyncWorker
import dev.convocados.wear.util.canScoreGame
import dev.convocados.wear.util.tickFlow
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import javax.inject.Inject

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
    val isStarting: Boolean = false,
    val isOfflineQueued: Boolean = false,
    val canScore: Boolean = false,
    val error: String? = null,
)

@HiltViewModel
class ScoreViewModel @Inject constructor(
    private val repository: WearGameRepository,
    private val scoreRepository: WearScoreRepository,
    private val workManager: WorkManager,
) : ViewModel() {

    private val _uiState = MutableStateFlow(ScoreUiState())
    val uiState: StateFlow<ScoreUiState> = _uiState.asStateFlow()

    @Volatile
    var tickProvider: () -> Flow<java.time.Instant> = { tickFlow() }

    private var eventId: String = ""

    fun load(eventId: String) {
        if (this.eventId == eventId) return
        this.eventId = eventId

        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }

            val game = repository.getGame(eventId)
            repository.refreshHistory(eventId)

            combine(
                repository.observeLatestHistory(eventId),
                tickProvider(),
            ) { history, _ ->
                history
            }.collect { history ->
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

    /** Start tracking the score for this game (creates today's history record). */
    fun startGame() {
        viewModelScope.launch {
            _uiState.update { it.copy(isStarting = true, error = null) }
            val result = repository.startGame(eventId)
            _uiState.update {
                it.copy(
                    isStarting = false,
                    error = if (result.isSuccess) null else "Assign teams first, then try again",
                )
            }
        }
    }

    fun incrementScoreOne() {
        _uiState.update { it.copy(scoreOne = it.scoreOne + 1) }
        scheduleSave()
    }

    fun decrementScoreOne() {
        _uiState.update { it.copy(scoreOne = maxOf(0, it.scoreOne - 1)) }
        scheduleSave()
    }

    fun incrementScoreTwo() {
        _uiState.update { it.copy(scoreTwo = it.scoreTwo + 1) }
        scheduleSave()
    }

    fun decrementScoreTwo() {
        _uiState.update { it.copy(scoreTwo = maxOf(0, it.scoreTwo - 1)) }
        scheduleSave()
    }

    private var saveJob: Job? = null

    /** Debounce rapid taps into one save; persists locally + remotely (queues if offline). */
    private fun scheduleSave() {
        saveJob?.cancel()
        saveJob = viewModelScope.launch {
            delay(500)
            val state = _uiState.value
            val historyId = state.history?.id ?: return@launch
            _uiState.update { it.copy(isSaving = true) }
            val result = scoreRepository.submitScore(
                eventId = eventId,
                historyId = historyId,
                scoreOne = state.scoreOne,
                scoreTwo = state.scoreTwo,
                teamOneName = state.teamOneName,
                teamTwoName = state.teamTwoName,
            )
            ScoreSyncWorker.enqueueOneTime(workManager)
            _uiState.update { it.copy(isSaving = false, isOfflineQueued = result.isFailure) }
        }
    }
}