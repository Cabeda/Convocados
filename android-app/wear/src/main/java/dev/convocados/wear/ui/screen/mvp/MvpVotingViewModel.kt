package dev.convocados.wear.ui.screen.mvp

import androidx.compose.runtime.Immutable
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import dev.convocados.wear.data.api.ApiException
import dev.convocados.wear.data.api.MvpResponse
import dev.convocados.wear.data.api.WearApiClient
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

@Immutable
data class MvpVotingUiState(
    val eventId: String? = null,
    val historyId: String? = null,
    val response: MvpResponse? = null,
    val isLoading: Boolean = true,
    val isSubmitting: Boolean = false,
    val error: String? = null,
)

@HiltViewModel
class MvpVotingViewModel @Inject constructor(
    private val client: WearApiClient,
) : ViewModel() {

    private val _uiState = MutableStateFlow(MvpVotingUiState())
    val uiState: StateFlow<MvpVotingUiState> = _uiState.asStateFlow()

    fun load(eventId: String, historyId: String) {
        if (_uiState.value.isSubmitting) return
        viewModelScope.launch {
            _uiState.update {
                it.copy(
                    eventId = eventId,
                    historyId = historyId,
                    isLoading = true,
                    error = null,
                )
            }
            try {
                val response = client.getMvp(eventId, historyId)
                _uiState.update {
                    it.copy(response = response, isLoading = false, error = null)
                }
            } catch (error: Exception) {
                _uiState.update {
                    it.copy(isLoading = false, error = errorMessage(error))
                }
            }
        }
    }

    fun vote(playerId: String) {
        val state = _uiState.value
        val eventId = state.eventId ?: return
        val historyId = state.historyId ?: return
        val response = state.response ?: return
        if (state.isLoading || state.isSubmitting || !response.isVotingOpen) return
        if (response.hasVoted == null) return
        if (response.participants.none { it.playerId == playerId }) return

        viewModelScope.launch {
            _uiState.update { it.copy(isSubmitting = true, error = null) }
            try {
                client.castMvpVote(eventId, historyId, playerId)
                val response = client.getMvp(eventId, historyId)
                _uiState.update {
                    it.copy(
                        response = response,
                        isSubmitting = false,
                        isLoading = false,
                        error = null,
                    )
                }
            } catch (error: Exception) {
                _uiState.update {
                    it.copy(isSubmitting = false, error = errorMessage(error))
                }
            }
        }
    }

    private fun errorMessage(error: Exception): String = when (error) {
        is ApiException -> when {
            error.code == 400 && error.message.orEmpty().contains("self", ignoreCase = true) ->
                "You cannot vote for yourself."
            error.code == 401 -> "Please sign in again."
            error.code == 403 -> "Only players in this game can vote."
            error.code == 404 -> "Game history not found."
            error.code == 429 -> "Too many votes. Try again later."
            else -> "Voting is not available right now."
        }
        else -> "Couldn't load voting. Check your connection and try again."
    }
}
