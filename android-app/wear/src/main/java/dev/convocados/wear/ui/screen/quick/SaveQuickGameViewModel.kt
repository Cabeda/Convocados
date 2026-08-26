package dev.convocados.wear.ui.screen.quick

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import dev.convocados.wear.data.api.ScoreRequest
import dev.convocados.wear.data.api.WatchGameResponse
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
            _uiState.update {
                it.copy(
                    quick = quickGameStore.state.value.takeIf { q -> q.isStarted },
                    events = gameRepository.observeGames().first(),
                )
            }
        }
    }

    /** Promote the quick game's score into [eventId]'s history. */
    fun saveTo(eventId: String) {
        val quick = _uiState.value.quick ?: return
        if (_uiState.value.saving != null) return
        viewModelScope.launch {
            _uiState.update { it.copy(saving = eventId, error = null) }
            try {
                val history = client.postForResult<WatchGameResponse>(
                    "/api/watch/events",
                    mapOf("eventId" to eventId),
                )
                client.patch<dev.convocados.wear.data.api.GameHistory>(
                    "/api/events/$eventId/history/${history.id}",
                    ScoreRequest(quick.scoreOne, quick.scoreTwo),
                )
                _uiState.update { it.copy(saving = null, saved = true, error = null) }
            } catch (e: Exception) {
                _uiState.update { it.copy(saving = null, error = e.message ?: "Failed to save") }
            }
        }
    }
}