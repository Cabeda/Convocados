package dev.convocados.wear.ui.screen.games

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import dev.convocados.wear.data.local.entity.WearGameEntity
import dev.convocados.wear.data.repository.WearGameRepository
import dev.convocados.wear.data.sync.ScoreSyncWorker
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import javax.inject.Inject
import kotlin.math.abs

data class GamesUiState(
    val games: List<WearGameEntity> = emptyList(),
    val suggestedGameId: String? = null,
    val isLoading: Boolean = true,
    val isOffline: Boolean = false,
    val pendingSyncCount: Int = 0,
)

@HiltViewModel
class GamesViewModel @Inject constructor(
    application: Application,
    private val repository: WearGameRepository,
) : AndroidViewModel(application) {

    private val _uiState = MutableStateFlow(GamesUiState())
    val uiState: StateFlow<GamesUiState> = _uiState.asStateFlow()

    init {
        // Schedule periodic sync
        ScoreSyncWorker.schedulePeriodic(application)

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
            _uiState.update { it.copy(isLoading = true) }
            val result = repository.refreshGames()
            _uiState.update {
                it.copy(
                    isLoading = false,
                    isOffline = result.isFailure,
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
            val gameTime = parseDateTime(game.dateTime) ?: return@minByOrNull Long.MAX_VALUE
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

    private fun parseDateTime(dateTime: String): Instant? = try {
        ZonedDateTime.parse(dateTime, DateTimeFormatter.ISO_DATE_TIME).toInstant()
    } catch (_: Exception) {
        try {
            Instant.parse(dateTime)
        } catch (_: Exception) {
            null
        }
    }
}
