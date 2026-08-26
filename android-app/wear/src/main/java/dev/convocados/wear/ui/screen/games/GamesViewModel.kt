package dev.convocados.wear.ui.screen.games

import androidx.compose.runtime.Immutable
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import android.util.Log
import androidx.work.WorkManager
import dagger.hilt.android.lifecycle.HiltViewModel
import dev.convocados.wear.data.local.entity.WearGameEntity
import dev.convocados.wear.data.repository.WearGameRepository
import dev.convocados.wear.data.repository.WearScoreRepository
import dev.convocados.wear.data.sync.ScoreSyncWorker
import dev.convocados.wear.util.canScoreGame
import dev.convocados.wear.util.isStalePastGame
import dev.convocados.wear.util.parseInstant
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.Instant
import java.time.temporal.ChronoUnit
import javax.inject.Inject
import kotlin.math.abs

@Immutable
data class GamesUiState(
    val games: List<WearGameEntity> = emptyList(),
    val pastGames: List<WearGameEntity> = emptyList(),
    val suggestedGameId: String? = null,
    val autoNavigateEventId: String? = null,
    val isLoading: Boolean = true,
    val isOffline: Boolean = false,
    val pendingSyncCount: Int = 0,
    val error: String? = null,
    val canScoreGameIds: Set<String> = emptySet(),
    val showPastGames: Boolean = false,
    val visiblePastCount: Int = 5,
)

@HiltViewModel
class GamesViewModel @Inject constructor(
    private val repository: WearGameRepository,
    private val scoreRepository: WearScoreRepository,
    private val workManager: WorkManager,
) : ViewModel() {

    private val _uiState = MutableStateFlow(GamesUiState())
    val uiState: StateFlow<GamesUiState> = _uiState.asStateFlow()

    private var hasAutoNavigated = false
    private var hasEnteredOnce = false

    /** Called on every screen entry; refreshes when returning (skips first load — init handles it). */
    fun onScreenEntered() {
        if (hasEnteredOnce) refresh()
        else hasEnteredOnce = true
    }

    init {
        ScoreSyncWorker.schedulePeriodic(workManager)

        viewModelScope.launch {
            combine(
                repository.observeGames(),
                repository.observeArchivedGames(),
                scoreRepository.observePendingCount(),
            ) { values ->
                @Suppress("UNCHECKED_CAST")
                Triple(
                    values[0] as List<WearGameEntity>,
                    values[1] as List<WearGameEntity>,
                    values[2] as Int,
                )
            } // combine emits only when data changes — no 1-minute tick re-emits.
                .collect { (games, archived, pending) ->
                    val now = Instant.now()
                    val upcoming = games.filter { !isStalePastGame(it.dateTime, it.isRecurring) }
                    val suggested = findBestGame(upcoming, now)
                    val scorable = upcoming.filter { canScoreGame(it.dateTime) }.map { it.id }.toSet()
                    val sorted = upcoming.sortedWith(
                        compareBy<WearGameEntity> { it.id != suggested?.id }
                            .thenBy { parseInstant(it.dateTime)?.let { t -> abs(ChronoUnit.MINUTES.between(now, t)) } ?: Long.MAX_VALUE }
                    )
                    _uiState.value = _uiState.value.copy(
                        games = sorted,
                        pastGames = archived,
                        suggestedGameId = suggested?.id,
                        autoNavigateEventId = if (!hasAutoNavigated && suggested != null && suggested.id in scorable) {
                            hasAutoNavigated = true
                            suggested.id
                        } else _uiState.value.autoNavigateEventId,
                        isLoading = false,
                        pendingSyncCount = pending,
                        canScoreGameIds = scorable,
                    )
                }
        }

        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }
            val result = repository.refreshGames()
            _uiState.update {
                // Offline-first: the localized offline banner (isOffline) tells
                // the story. Raw exception messages (e.g. "Socket timeout has
                // expired") never belong on screen.
                it.copy(
                    isLoading = false,
                    isOffline = result.isFailure,
                    error = null,
                )
            }
        }
    }

    fun togglePastGames() {
        _uiState.update { it.copy(showPastGames = !it.showPastGames, visiblePastCount = 5) }
    }

    fun consumeAutoNavigate() {
        _uiState.update { it.copy(autoNavigateEventId = null) }
    }

    fun loadMorePast() {
        _uiState.update { it.copy(visiblePastCount = it.visiblePastCount + 5) }
    }

    private fun findBestGame(games: List<WearGameEntity>, now: Instant): WearGameEntity? {
        if (games.isEmpty()) return null

        return games.minByOrNull { game ->
            val gameTime = parseInstant(game.dateTime) ?: return@minByOrNull Long.MAX_VALUE
            val diffMinutes = ChronoUnit.MINUTES.between(now, gameTime)

            when {
                diffMinutes in -120..0 -> abs(diffMinutes)
                diffMinutes in 1..120 -> diffMinutes + 10
                diffMinutes > 120 -> diffMinutes * 2
                else -> abs(diffMinutes) * 3
            }
        }
    }
}