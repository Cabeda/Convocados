package dev.convocados.wear.ui.screen.quick

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import dev.convocados.wear.data.api.ApiException
import dev.convocados.wear.data.api.ScoreRequest
import dev.convocados.wear.data.api.WearApiClient
import dev.convocados.wear.data.local.QuickGameState
import dev.convocados.wear.data.local.QuickGameStore
import dev.convocados.wear.data.local.entity.WearGameEntity
import dev.convocados.wear.data.repository.WearGameRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class SaveQuickGameUiState(
    val quick: QuickGameState? = null,
    val events: List<WearGameEntity> = emptyList(),
    val saving: String? = null,
    val saved: Boolean = false,
    val error: String? = null,
)

@HiltViewModel
class SaveQuickGameViewModel @Inject constructor(
    private val client: WearApiClient,
    private val quickGameStore: QuickGameStore,
    private val gameRepository: WearGameRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(SaveQuickGameUiState())
    val uiState: StateFlow<SaveQuickGameUiState> = _uiState.asStateFlow()

    fun load() {
        viewModelScope.launch {
            val quick = quickGameStore.state.value.takeIf { it.isStarted }
            val events = gameRepository.observeGames().first()
            _uiState.update {
                it.copy(
                    quick = quick,
                    events = events.filter { event ->
                        (event.type == "owned" || event.type == "admin") &&
                            (quick == null || isQuickSaveCompatible(quick.sport, event.sport))
                    },
                )
            }
        }
    }

    /** Promote the quick game's score into [eventId]'s history. */
    fun saveTo(eventId: String) {
        val quick = _uiState.value.quick ?: return
        val event = _uiState.value.events.firstOrNull { it.id == eventId } ?: return
        if (!isQuickSaveCompatible(quick.sport, event.sport)) return
        while (true) {
            val current = _uiState.value
            if (current.saving != null || current.saved) return
            if (_uiState.compareAndSet(current, current.copy(saving = eventId, error = null))) break
        }
        viewModelScope.launch {
            try {
                val history = client.createWatchGameHistory(eventId)
                client.patchGameHistory(
                    "/api/events/$eventId/history/${history.id}",
                    ScoreRequest(
                        scoreOne = quick.scoreOne,
                        scoreTwo = quick.scoreTwo,
                        scoreSets = quick.scoreSets.takeIf {
                            isQuickStructuredSport(quick.sport) && it.isNotEmpty()
                        },
                    ),
                )
                runCatching { gameRepository.refreshHistory(eventId) }
                quickGameStore.clear()
                _uiState.update { it.copy(saving = null, saved = true, error = null) }
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(saving = null, error = saveErrorMessage(e))
                }
            }
        }
    }

    private fun saveErrorMessage(error: Exception): String = when (error) {
        is ApiException -> when (error.code) {
            401 -> "Please sign in again to save this game."
            403 -> "You do not have permission to save to this event."
            404 -> "Event not found. Refresh your games and try again."
            else -> "Couldn't save quick game. Check your connection and try again."
        }
        else -> "Couldn't save quick game. Check your connection and try again."
    }
}


internal fun isQuickSaveCompatible(quickSport: String, eventSport: String): Boolean {
    val normalizedEventSport = eventSport.lowercase()
    val structuredEventSports = setOf("tennis", "tennis-singles", "tennis-doubles", "padel")
    return if (isQuickStructuredSport(quickSport)) {
        normalizedEventSport in structuredEventSports
    } else {
        normalizedEventSport !in structuredEventSports
    }
}
