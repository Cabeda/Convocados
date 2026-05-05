package dev.convocados.wear.ui.screen.games

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import android.util.Log
import androidx.work.WorkManager
import dagger.hilt.android.lifecycle.HiltViewModel
import dev.convocados.wear.data.local.entity.WearGameEntity
import dev.convocados.wear.data.repository.WearGameRepository
import dev.convocados.wear.data.sync.ScoreSyncWorker
import dev.convocados.wear.util.canScoreGame
import dev.convocados.wear.util.isStalePastGame
import dev.convocados.wear.util.parseInstant
import dev.convocados.wear.util.tickFlow
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.temporal.ChronoUnit
import javax.inject.Inject
import kotlin.math.abs

data class GamesUiState(
    val games: List<WearGameEntity> = emptyList(),
    val pastGames: List<WearGameEntity> = emptyList(),
    val suggestedGameId: String? = null,
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
    private val workManager: WorkManager,
) : ViewModel() {

    private val _uiState = MutableStateFlow(GamesUiState())
    val uiState: StateFlow<GamesUiState> = _uiState.asStateFlow()

    @Volatile
    var tickProvider: () -> Flow<Instant> = { tickFlow() }

    init {
        ScoreSyncWorker.schedulePeriodic(workManager)

        viewModelScope.launch {
            combine(
                repository.observeGames(),
                repository.observeArchivedGames(),
                repository.observePendingCount(),
                tickProvider(),
            ) { games, archived, pending, _ ->
                Triple(games, archived, pending)
            }.collect { (games, archived, pending) ->
                val upcoming = games.filter { !isStalePastGame(it.dateTime, it.isRecurring) }
                val suggested = findBestGame(upcoming)
                val scorable = upcoming.filter { canScoreGame(it.dateTime) }.map { it.id }.toSet()
                _uiState.value = _uiState.value.copy(
                    games = upcoming,
                    pastGames = archived,
                    suggestedGameId = suggested?.id,
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
                it.copy(
                    isLoading = false,
                    isOffline = result.isFailure,
                    error = result.exceptionOrNull()?.message,
                )
            }
        }
    }

    fun togglePastGames() {
        _uiState.update { it.copy(showPastGames = !it.showPastGames, visiblePastCount = 5) }
    }

    fun loadMorePast() {
        _uiState.update { it.copy(visiblePastCount = it.visiblePastCount + 5) }
    }

    private fun findBestGame(games: List<WearGameEntity>): WearGameEntity? {
        if (games.isEmpty()) return null
        val now = Instant.now()

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