package dev.convocados.wear.ui.screen.games

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.work.WorkManager
import dagger.hilt.android.lifecycle.HiltViewModel
import dev.convocados.wear.data.local.entity.WearGameEntity
import dev.convocados.wear.data.repository.WearGameRepository
import dev.convocados.wear.data.sync.ScoreSyncWorker
import dev.convocados.wear.util.parseInstant
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.temporal.ChronoUnit
import javax.inject.Inject
import kotlin.math.abs

data class GamesUiState(
    val games: List<WearGameEntity> = emptyList(),
    val suggestedGameId: String? = null,
    val isLoading: Boolean = true,
    val isOffline: Boolean = false,
    val pendingSyncCount: Int = 0,
    val error: String? = null,
)

@HiltViewModel
class GamesViewModel @Inject constructor(
    private val repository: WearGameRepository,
    private val workManager: WorkManager,
) : ViewModel() {

    private val _uiState = MutableStateFlow(GamesUiState())
    val uiState: StateFlow<GamesUiState> = _uiState.asStateFlow()

    init {
        // Schedule periodic sync
        ScoreSyncWorker.schedulePeriodic(workManager)

        // Observe cached games
        viewModelScope.launch {
            repository.observeGames().combine(repository.observePendingCount()) { games, pending ->
                val suggested = findBestGame(games)
                _uiState.value = _uiState.value.copy(
                    games = games,
                    suggestedGameId = suggested?.id,
                    isLoading = false,
                    pendingSyncCount = pending,
                )
            }.collect()
        }

        // Initial refresh
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

    /**
     * Smart game selection: pick the game whose dateTime is closest to "now".
     * Prefers games that are currently happening (within duration window)
     * or about to start (within next 2 hours).
     */
    private fun findBestGame(games: List<WearGameEntity>): WearGameEntity? {
        if (games.isEmpty()) return null
        val now = Instant.now()

        return games.minByOrNull { game ->
            val gameTime = parseInstant(game.dateTime) ?: return@minByOrNull Long.MAX_VALUE
            val diffMinutes = ChronoUnit.MINUTES.between(now, gameTime)

            when {
                // Currently happening (started within last 120 min)
                diffMinutes in -120..0 -> abs(diffMinutes)
                // Starting soon (next 2 hours) — slight preference
                diffMinutes in 1..120 -> diffMinutes + 10
                // Future games
                diffMinutes > 120 -> diffMinutes * 2
                // Past games (ended more than 2h ago)
                else -> abs(diffMinutes) * 3
            }
        }
    }
}
