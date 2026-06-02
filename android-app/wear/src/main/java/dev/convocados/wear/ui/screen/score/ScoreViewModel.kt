package dev.convocados.wear.ui.screen.score

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.work.WorkManager
import dagger.hilt.android.lifecycle.HiltViewModel
import dev.convocados.wear.data.api.ApiException
import dev.convocados.wear.data.alarm.GameAlarmScheduler
import dev.convocados.wear.data.alarm.GameSettingsStore
import dev.convocados.wear.data.alarm.computeAlarmTimes
import dev.convocados.wear.data.local.entity.WearGameEntity
import dev.convocados.wear.data.local.entity.WearHistoryEntity
import dev.convocados.wear.data.repository.WearGameRepository
import dev.convocados.wear.data.repository.WearScoreRepository
import dev.convocados.wear.data.sync.ScoreSyncWorker
import dev.convocados.wear.util.parseInstant
import dev.convocados.wear.util.sportDurationMinutes
import dev.convocados.wear.util.tickFlow
import kotlinx.coroutines.flow.*
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
    val isStarting: Boolean = false,
    val isOfflineQueued: Boolean = false,
    val kickoffEpochMs: Long? = null,
    val nextAlarmAtMs: Long? = null,
    val error: String? = null,
)

@HiltViewModel
class ScoreViewModel @Inject constructor(
    private val repository: WearGameRepository,
    private val scoreRepository: WearScoreRepository,
    private val settingsStore: GameSettingsStore,
    private val alarmScheduler: GameAlarmScheduler,
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
            val scheduledKickoffMs = game?.dateTime?.let { parseInstant(it)?.toEpochMilli() }
            val durationMinutes = game?.let { sportDurationMinutes(it.sport) } ?: 60
            repository.refreshHistory(eventId)

            combine(
                repository.observeLatestHistory(eventId),
                settingsStore.settings(eventId),
                tickProvider(),
            ) { history, settings, _ ->
                Triple(history, settings, System.currentTimeMillis())
            }.collect { (history, settings, now) ->
                val kickoffMs = settings.kickoffEpochMs ?: scheduledKickoffMs
                val nextAlarm = kickoffMs?.let {
                    computeAlarmTimes(it, settings.alarms, durationMinutes, now).firstOrNull()?.triggerAtMs
                }
                _uiState.update { state ->
                    state.copy(
                        game = game,
                        history = history,
                        scoreOne = history?.scoreOne ?: state.scoreOne,
                        scoreTwo = history?.scoreTwo ?: state.scoreTwo,
                        teamOneName = history?.teamOneName ?: game?.teamOneName ?: "Team 1",
                        teamTwoName = history?.teamTwoName ?: game?.teamTwoName ?: "Team 2",
                        kickoffEpochMs = kickoffMs,
                        nextAlarmAtMs = nextAlarm,
                        isLoading = false,
                    )
                }
            }
        }
    }

    /** Leaving the game cancels all of its pending alarms. */
    override fun onCleared() {
        if (eventId.isNotEmpty()) alarmScheduler.cancelAll(eventId)
    }

    /** Start tracking the score for this game (creates today's history record). */
    fun startGame() {
        viewModelScope.launch {
            _uiState.update { it.copy(isStarting = true, error = null) }
            val result = repository.startGame(eventId)
            _uiState.update {
                it.copy(isStarting = false, error = startErrorMessage(result.exceptionOrNull()))
            }
        }
    }

    fun incrementScoreOne() {
        _uiState.update { it.copy(scoreOne = it.scoreOne + 1) }
        persist()
    }

    fun decrementScoreOne() {
        _uiState.update { it.copy(scoreOne = maxOf(0, it.scoreOne - 1)) }
        persist()
    }

    fun incrementScoreTwo() {
        _uiState.update { it.copy(scoreTwo = it.scoreTwo + 1) }
        persist()
    }

    fun decrementScoreTwo() {
        _uiState.update { it.copy(scoreTwo = maxOf(0, it.scoreTwo - 1)) }
        persist()
    }

    private var saving = false
    private var pendingSave = false

    /**
     * Persist the score on every change. submitScore writes the local DB first
     * (instant, survives going offline) then pushes to the server, queuing for
     * sync on failure. Calls are coalesced + serialized so rapid taps always
     * end on the latest value without overlapping requests.
     */
    private fun persist() {
        if (_uiState.value.history?.id == null) return
        pendingSave = true
        if (saving) return
        saving = true
        viewModelScope.launch {
            while (pendingSave) {
                pendingSave = false
                val s = _uiState.value
                val historyId = s.history?.id ?: break
                val result = scoreRepository.submitScore(
                    eventId = eventId,
                    historyId = historyId,
                    scoreOne = s.scoreOne,
                    scoreTwo = s.scoreTwo,
                    teamOneName = s.teamOneName,
                    teamTwoName = s.teamTwoName,
                )
                _uiState.update { it.copy(isOfflineQueued = result.isFailure) }
            }
            ScoreSyncWorker.enqueueOneTime(workManager)
            saving = false
        }
    }
}

/** Maps a startGame failure to a short, user-facing reason. */
internal fun startErrorMessage(e: Throwable?): String? = when {
    e == null -> null
    e is ApiException && e.code == 400 -> "Assign teams first"
    e is ApiException && e.code == 401 -> "Session expired — sign in again"
    e is ApiException -> "Couldn't start (${e.code})"
    else -> "Couldn't start — check connection"
}