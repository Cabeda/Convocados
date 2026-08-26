package dev.convocados.wear.ui.screen.teams

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import dev.convocados.wear.data.api.AddPlayerRequest
import dev.convocados.wear.data.api.KnownPlayer
import dev.convocados.wear.data.api.KnownPlayersResponse
import dev.convocados.wear.data.api.WearApiClient
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class AddPlayerUiState(
    val known: List<KnownPlayer> = emptyList(),
    val isLoading: Boolean = true,
    val adding: String? = null,
    val error: String? = null,
)

@HiltViewModel
class AddPlayerViewModel @Inject constructor(
    private val client: WearApiClient,
) : ViewModel() {

    private val _uiState = MutableStateFlow(AddPlayerUiState())
    val uiState: StateFlow<AddPlayerUiState> = _uiState.asStateFlow()

    fun load(eventId: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }
            try {
                val res = client.get<KnownPlayersResponse>("/api/events/$eventId/known-players")
                _uiState.update { it.copy(known = res.players, isLoading = false) }
            } catch (e: Exception) {
                _uiState.update { it.copy(isLoading = false, error = e.message ?: "Failed to load") }
            }
        }
    }

    fun add(eventId: String, name: String) {
        if (_uiState.value.adding != null) return
        viewModelScope.launch {
            _uiState.update { it.copy(adding = name, error = null) }
            try {
                client.post("/api/events/$eventId/players", AddPlayerRequest(name))
                _uiState.update { it.copy(adding = null, known = it.known.filterNot { k -> k.name == name }) }
            } catch (e: Exception) {
                _uiState.update { it.copy(adding = null, error = e.message ?: "Failed to add") }
            }
        }
    }
}