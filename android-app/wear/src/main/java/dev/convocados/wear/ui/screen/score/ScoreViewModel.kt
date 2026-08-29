package dev.convocados.wear.ui.screen.score

import androidx.compose.runtime.Immutable
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.work.WorkManager
import dagger.hilt.android.lifecycle.HiltViewModel
import dev.convocados.wear.data.api.ApiException
import dev.convocados.wear.data.api.SetScore
import dev.convocados.wear.data.api.TennisTeam
import dev.convocados.wear.data.api.advanceTennisPoint
import dev.convocados.wear.data.api.rewindTennisSetPoint
import dev.convocados.wear.data.api.tennisGameScore
import dev.convocados.wear.data.api.withTennisGameScore
import dev.convocados.wear.data.alarm.GameSettingsStore
import dev.convocados.wear.data.alarm.computeAlarmFractions
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
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import javax.inject.Inject

enum class Team { ONE, TWO }

@Immutable
data class ScoreUiState(
    val game: WearGameEntity? = null,
    val history: WearHistoryEntity? = null,
    val scoreOne: Int = 0,
    val scoreTwo: Int = 0,
    val hasFinalScore: Boolean = false,
    val scoreSets: List<SetScore> = emptyList(),
    /** A legacy scalar result shown until the user explicitly starts point scoring. */
    val legacyScalarScore: Pair<Int, Int>? = null,
    val isTennisScoring: Boolean = false,
    val isTiebreakScoring: Boolean = false,
    val teamOneName: String = "Team 1",
    val teamTwoName: String = "Team 2",
    val isLoading: Boolean = true,
    val isStarting: Boolean = false,
    val isOfflineQueued: Boolean = false,
    val kickoffEpochMs: Long? = null,
    val nextAlarmAtMs: Long? = null,
    val error: String? = null,
    val keepScreenOn: Boolean = true,
    // ADR 0027: alarm tick positions on the progress ring (fraction 0..1 of the
    // game window, from computeAlarmTimes) + the next upcoming tick to emphasise.
    val alarmFractions: List<Float> = emptyList(),
    val nextAlarmFraction: Float? = null,
)

@HiltViewModel
class ScoreViewModel @Inject constructor(
    private val repository: WearGameRepository,
    private val scoreRepository: WearScoreRepository,
    private val settingsStore: GameSettingsStore,
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
                repository.observeLatestHistoryForEvent(eventId),
                settingsStore.settings(eventId),
                tickProvider(),
            ) { history, settings, _ ->
                Triple(history, settings, System.currentTimeMillis())
            }.collect { (history, settings, now) ->
                val kickoffMs = settings.kickoffEpochMs ?: scheduledKickoffMs
                val nextAlarm = kickoffMs?.let {
                    computeAlarmTimes(it, settings.alarms, durationMinutes, now).firstOrNull()?.triggerAtMs
                }
                // ADR 0027: project every enabled alarm onto the ring as a fraction
                // of the game window, and highlight the next upcoming one.
                val alarmFractions = computeAlarmFractions(settings.alarms, durationMinutes)
                val totalMs = durationMinutes * 60_000L
                val nextAlarmFraction = nextAlarm?.let { n -> kickoffMs?.let { k -> ((n - k).toFloat() / totalMs).coerceIn(0f, 1f) } }
                _uiState.update { state ->
                    val parsedScoreSets = if (history == null) {
                        state.scoreSets
                    } else {
                        history.scoreSetsJson?.let { runCatching { Json.decodeFromString<List<SetScore>>(it) }.getOrNull() } ?: emptyList()
                    }
                    val tennisScoring = isStructuredTennisScore(game?.sport)
                    val hasStructuredScore = tennisScoring && parsedScoreSets.isNotEmpty()
                    state.copy(
                        game = game,
                        history = history,
                        scoreOne = if (hasStructuredScore) matchScoreFromSets(parsedScoreSets).first else if (history == null) state.scoreOne else history.scoreOne ?: 0,
                        scoreTwo = if (hasStructuredScore) matchScoreFromSets(parsedScoreSets).second else if (history == null) state.scoreTwo else history.scoreTwo ?: 0,
                        // Nullable scalar scores are deliberately retained by the
                        // API while a structured match is incomplete. Do not
                        // turn the local fallback 0-0 values into a final result.
                        hasFinalScore = if (hasStructuredScore) hasCompletedMatch(parsedScoreSets)
                            else history?.scoreOne != null && history?.scoreTwo != null,
                        scoreSets = parsedScoreSets,
                        legacyScalarScore = if (tennisScoring && history?.scoreSetsJson == null && history?.scoreOne != null && history.scoreTwo != null) {
                            history.scoreOne to history.scoreTwo
                        } else {
                            null
                        },
                        isTennisScoring = tennisScoring,
                        isTiebreakScoring = if (history == null) {
                            state.isTiebreakScoring
                        } else {
                            parsedScoreSets.lastOrNull()?.tiebreakTeamOne != null
                        },
                        teamOneName = history?.teamOneName ?: game?.teamOneName ?: "Team 1",
                        teamTwoName = history?.teamTwoName ?: game?.teamTwoName ?: "Team 2",
                        kickoffEpochMs = kickoffMs,
                        nextAlarmAtMs = nextAlarm,
                        alarmFractions = alarmFractions,
                        nextAlarmFraction = nextAlarmFraction,
                        keepScreenOn = settings.keepScreenOn,
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
                it.copy(isStarting = false, error = startErrorMessage(result.exceptionOrNull()))
            }
        }
    }

    fun incrementScoreOne() = changeScoreOne(1)

    fun decrementScoreOne() = changeScoreOne(-1)

    fun incrementScoreTwo() = changeScoreTwo(1)

    fun decrementScoreTwo() = changeScoreTwo(-1)

    private fun changeScoreOne(delta: Int) {
        if (_uiState.value.isTennisScoring) changeActiveSet("one", delta) else {
            rememberScore()
            _uiState.update { it.copy(scoreOne = maxOf(0, it.scoreOne + delta)) }
            persist()
        }
    }

    private fun changeScoreTwo(delta: Int) {
        if (_uiState.value.isTennisScoring) changeActiveSet("two", delta) else {
            rememberScore()
            _uiState.update { it.copy(scoreTwo = maxOf(0, it.scoreTwo + delta)) }
            persist()
        }
    }

    private fun changeActiveSet(side: String, delta: Int) {
        val state = _uiState.value
        if (state.scoreSets.isEmpty() && delta < 0) return
        val current = state.scoreSets.ifEmpty { listOf(SetScore(0, 0)) }
        if (delta > 0 && isCompletedSet(current.last())) return

        rememberScore()
        val updatedSets = current.dropLast(1) + current.last().let { set ->
            if (_uiState.value.isTiebreakScoring) {
                if (side == "one") set.copy(tiebreakTeamOne = maxOf(0, (set.tiebreakTeamOne ?: 0) + delta), tiebreakTeamTwo = set.tiebreakTeamTwo ?: 0)
                else set.copy(tiebreakTeamOne = set.tiebreakTeamOne ?: 0, tiebreakTeamTwo = maxOf(0, (set.tiebreakTeamTwo ?: 0) + delta))
            } else {
                val team = if (side == "one") TennisTeam.ONE else TennisTeam.TWO
                if (delta < 0) {
                    rewindTennisSetPoint(set, team)
                } else {
                    val pointResult = advanceTennisPoint(set.tennisGameScore(), team)
                    val withPoints = set.withTennisGameScore(pointResult.score)
                    when (pointResult.completedTeam) {
                        TennisTeam.ONE -> withPoints.copy(
                            teamOne = set.teamOne + 1,
                            pointGameActive = false,
                            pointGameCompletedBy = TennisTeam.ONE.serializedValue,
                        )
                        TennisTeam.TWO -> withPoints.copy(
                            teamTwo = set.teamTwo + 1,
                            pointGameActive = false,
                            pointGameCompletedBy = TennisTeam.TWO.serializedValue,
                        )
                        null -> withPoints
                    }
                }
            }
        }
        val match = matchScoreFromSets(updatedSets)
        _uiState.update { it.copy(scoreSets = updatedSets, scoreOne = match.first, scoreTwo = match.second, hasFinalScore = hasCompletedMatch(updatedSets), legacyScalarScore = null) }
        persist()
    }

    fun toggleTiebreak() {
        if (!_uiState.value.isTennisScoring) return
        if (_uiState.value.legacyScalarScore != null && _uiState.value.scoreSets.isEmpty()) return
        val current = _uiState.value.scoreSets.ifEmpty { listOf(SetScore(0, 0)) }
        val last = current.last()
        val entering = last.tiebreakTeamOne == null || last.tiebreakTeamTwo == null
        val updated = current.dropLast(1) + if (entering) last.copy(
            tiebreakTeamOne = 0,
            tiebreakTeamTwo = 0,
            pointTeamOne = null,
            pointTeamTwo = null,
            pointGameActive = false,
            pointGameCompletedBy = null,
        ) else {
            last.copy(
                tiebreakTeamOne = null,
                tiebreakTeamTwo = null,
                pointTeamOne = null,
                pointTeamTwo = null,
                pointGameActive = false,
                pointGameCompletedBy = null,
            )
        }
        _uiState.update { it.copy(scoreSets = updated, isTiebreakScoring = entering, hasFinalScore = hasCompletedMatch(updated), legacyScalarScore = null) }
        persist()
    }

    fun advanceSet() {
        if (!_uiState.value.isTennisScoring || _uiState.value.scoreSets.size >= 5) return
        if (_uiState.value.legacyScalarScore != null && _uiState.value.scoreSets.isEmpty()) return
        rememberScore()
        val updatedSets = if (_uiState.value.scoreSets.isEmpty()) {
            listOf(SetScore(0, 0))
        } else {
            _uiState.value.scoreSets + SetScore(0, 0)
        }
        _uiState.update { it.copy(scoreSets = updatedSets, isTiebreakScoring = false, hasFinalScore = false, legacyScalarScore = null) }
        persist()
    }

    private var previousScore: Pair<Int, Int>? = null
    private var previousScoreSets: List<SetScore>? = null
    private var previousLegacyScalarScore: Pair<Int, Int>? = null

    private fun rememberScore() {
        previousScore = _uiState.value.scoreOne to _uiState.value.scoreTwo
        previousScoreSets = _uiState.value.scoreSets
        previousLegacyScalarScore = _uiState.value.legacyScalarScore
    }

    /** Revert the last score edit (single-level undo). */
    fun undoLastScore() {
        val prev = previousScore ?: return
        previousScore = null
        val sets = previousScoreSets ?: emptyList()
        val legacyScalarScore = previousLegacyScalarScore
        _uiState.update {
            it.copy(
                scoreOne = prev.first,
                scoreTwo = prev.second,
                scoreSets = sets,
                legacyScalarScore = legacyScalarScore,
                hasFinalScore = if (it.isTennisScoring) {
                    if (sets.isNotEmpty()) hasCompletedMatch(sets) else legacyScalarScore != null
                } else {
                    it.hasFinalScore
                },
            )
        }
        previousScoreSets = null
        previousLegacyScalarScore = null
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
                    scoreSets = s.scoreSets.takeIf { s.isTennisScoring && it.isNotEmpty() },
                )
                _uiState.update {
                    it.copy(isOfflineQueued = result.exceptionOrNull()?.let(::isRetryableScoreFailure) == true)
                }
            }
            ScoreSyncWorker.enqueueOneTime(workManager)
            saving = false
        }
    }
}

private fun isTennisSport(sport: String?): Boolean = sport?.lowercase() in setOf("tennis", "tennis-singles", "tennis-doubles", "padel")

private fun isStructuredTennisScore(sport: String?): Boolean = isTennisSport(sport)

internal fun hasCompletedMatch(sets: List<SetScore>): Boolean =
    sets.isNotEmpty() && sets.all(::isCompletedSet)

internal fun matchScoreFromSets(sets: List<SetScore>): Pair<Int, Int> = sets.fold(0 to 0) { score, set ->
    if (!isCompletedSet(set)) return@fold score
    val hasTiebreak = set.tiebreakTeamOne != null && set.tiebreakTeamTwo != null
    val teamOneWon = if (hasTiebreak) set.tiebreakTeamOne!! > set.tiebreakTeamTwo!! else set.teamOne > set.teamTwo
    val teamTwoWon = if (hasTiebreak) set.tiebreakTeamTwo!! > set.tiebreakTeamOne!! else set.teamTwo > set.teamOne
    when {
        teamOneWon -> (score.first + 1) to score.second
        teamTwoWon -> score.first to (score.second + 1)
        else -> score
    }
}

private fun isCompletedSet(set: SetScore): Boolean {
    val hasTiebreak = set.tiebreakTeamOne != null && set.tiebreakTeamTwo != null
    if (hasTiebreak) {
        return maxOf(set.tiebreakTeamOne!!, set.tiebreakTeamTwo!!) >= 7 &&
            kotlin.math.abs(set.tiebreakTeamOne!! - set.tiebreakTeamTwo!!) >= 2
    }
    val high = maxOf(set.teamOne, set.teamTwo)
    return high >= 6 && (kotlin.math.abs(set.teamOne - set.teamTwo) >= 2 || high >= 7)
}

internal fun isRetryableScoreFailure(exception: Throwable): Boolean = when (exception) {
    is ApiException -> exception.code == 0 || exception.code == 401 || exception.code == 403 ||
        exception.code == 408 || exception.code == 429 || exception.code >= 500
    else -> true
}

/** Maps a startGame failure to a short, user-facing reason. */
internal fun startErrorMessage(e: Throwable?): String? = when {
    e == null -> null
    e is ApiException && e.code == 400 -> "Assign teams first"
    e is ApiException && e.code == 401 -> "Session expired — sign in again"
    e is ApiException && e.code == 403 -> parseApiError(e.message) ?: "Not authorized"
    e is ApiException -> "Couldn't start (${e.code})"
    else -> "Couldn't start — check connection"
}

private fun parseApiError(body: String?): String? {
    if (body == null) return null
    val match = Regex(""""error"\s*:\s*"([^"]+)"""").find(body)
    return match?.groupValues?.get(1)
}