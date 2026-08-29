package dev.convocados.wear.ui.screen.quick

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import dev.convocados.wear.data.alarm.AlarmFire
import dev.convocados.wear.data.alarm.GameAlarmScheduler
import dev.convocados.wear.data.api.SetScore
import dev.convocados.wear.data.api.TennisTeam
import dev.convocados.wear.data.api.advanceTennisPoint
import dev.convocados.wear.data.api.rewindTennisSetPoint
import dev.convocados.wear.data.api.tennisGameScore
import dev.convocados.wear.data.api.withTennisGameScore
import dev.convocados.wear.data.local.QUICK_SPORT_PADEL
import dev.convocados.wear.data.local.QUICK_SPORT_STANDARD
import dev.convocados.wear.data.local.QUICK_SPORT_TENNIS
import dev.convocados.wear.data.local.QuickGameState
import dev.convocados.wear.data.local.QuickGameStore
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
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
    fun startNew(durationMinutes: Int, alarmIntervalMinutes: Int, sport: String = QUICK_SPORT_STANDARD) {
        applyAndSchedule { it.copy(
            scoreOne = 0,
            scoreTwo = 0,
            sport = normalizeSport(sport),
            scoreSets = emptyList(),
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
            scoreSets = emptyList(),
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

    fun incrementScoreOne() = changeScore("one", 1)

    fun decrementScoreOne() = changeScore("one", -1)

    fun incrementScoreTwo() = changeScore("two", 1)

    fun decrementScoreTwo() = changeScore("two", -1)

    /** Switch the current tennis/padel set between games and tiebreak points. */
    fun toggleTiebreak() {
        val state = quickGameStore.state.value
        if (!isStructuredSport(state.sport)) return
        val current = state.scoreSets.ifEmpty { listOf(SetScore(0, 0)) }
        val last = current.last()
        val entering = last.tiebreakTeamOne == null || last.tiebreakTeamTwo == null
        val updated = current.dropLast(1) + if (entering) {
            last.copy(
                tiebreakTeamOne = 0,
                tiebreakTeamTwo = 0,
                pointTeamOne = null,
                pointTeamTwo = null,
                pointGameActive = false,
                pointGameCompletedBy = null,
            )
        } else {
            last.copy(
                tiebreakTeamOne = null,
                tiebreakTeamTwo = null,
                pointTeamOne = null,
                pointTeamTwo = null,
                pointGameActive = false,
                pointGameCompletedBy = null,
            )
        }
        val match = matchScoreFromSets(updated)
        quickGameStore.update {
            it.copy(
                scoreSets = updated,
                scoreOne = match.first,
                scoreTwo = match.second,
            )
        }
    }

    /** Start another set without changing the selected sport. */
    fun advanceSet() {
        val state = quickGameStore.state.value
        if (!isStructuredSport(state.sport) || state.scoreSets.size >= 5) return
        val updated = if (state.scoreSets.isEmpty()) {
            listOf(SetScore(0, 0))
        } else {
            state.scoreSets + SetScore(0, 0)
        }
        quickGameStore.update { it.copy(scoreSets = updated) }
    }

    private fun changeScore(side: String, delta: Int) {
        val state = quickGameStore.state.value
        if (!isStructuredSport(state.sport)) {
            quickGameStore.update {
                if (side == "one") it.copy(scoreOne = maxOf(0, it.scoreOne + delta))
                else it.copy(scoreTwo = maxOf(0, it.scoreTwo + delta))
            }
            return
        }

        val current = state.scoreSets.ifEmpty { listOf(SetScore(0, 0)) }
        if (delta < 0 && state.scoreSets.isEmpty()) return
        if (delta > 0 && isCompletedSet(current.last())) return
        val updated = current.dropLast(1) + current.last().let { set ->
            if (set.tiebreakTeamOne != null && set.tiebreakTeamTwo != null) {
                if (side == "one") {
                    set.copy(tiebreakTeamOne = maxOf(0, set.tiebreakTeamOne + delta))
                } else {
                    set.copy(tiebreakTeamTwo = maxOf(0, set.tiebreakTeamTwo + delta))
                }
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
        val match = matchScoreFromSets(updated)
        quickGameStore.update {
            it.copy(
                scoreSets = updated,
                scoreOne = match.first,
                scoreTwo = match.second,
            )
        }
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

private fun normalizeSport(sport: String): String = when (sport.lowercase()) {
    QUICK_SPORT_TENNIS -> QUICK_SPORT_TENNIS
    QUICK_SPORT_PADEL -> QUICK_SPORT_PADEL
    else -> QUICK_SPORT_STANDARD
}

internal fun isQuickStructuredSport(sport: String): Boolean = isStructuredSport(sport)

private fun isStructuredSport(sport: String): Boolean = sport.lowercase() in setOf(
    QUICK_SPORT_TENNIS,
    QUICK_SPORT_PADEL,
)

private fun matchScoreFromSets(sets: List<SetScore>): Pair<Int, Int> = sets.fold(0 to 0) { score, set ->
    if (!isCompletedSet(set)) return@fold score
    val teamOneWon = if (set.tiebreakTeamOne != null && set.tiebreakTeamTwo != null) {
        set.tiebreakTeamOne > set.tiebreakTeamTwo
    } else {
        set.teamOne > set.teamTwo
    }
    val teamTwoWon = if (set.tiebreakTeamOne != null && set.tiebreakTeamTwo != null) {
        set.tiebreakTeamTwo > set.tiebreakTeamOne
    } else {
        set.teamTwo > set.teamOne
    }
    when {
        teamOneWon -> (score.first + 1) to score.second
        teamTwoWon -> score.first to (score.second + 1)
        else -> score
    }
}

private fun isCompletedSet(set: SetScore): Boolean {
    if (set.tiebreakTeamOne != null && set.tiebreakTeamTwo != null) {
        return maxOf(set.tiebreakTeamOne, set.tiebreakTeamTwo) >= 7 &&
            kotlin.math.abs(set.tiebreakTeamOne - set.tiebreakTeamTwo) >= 2
    }
    val high = maxOf(set.teamOne, set.teamTwo)
    return high >= 6 && (kotlin.math.abs(set.teamOne - set.teamTwo) >= 2 || high >= 7)
}
