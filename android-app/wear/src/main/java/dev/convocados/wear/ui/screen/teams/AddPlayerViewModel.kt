package dev.convocados.wear.ui.screen.teams

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.work.WorkManager
import dagger.hilt.android.lifecycle.HiltViewModel
import dev.convocados.wear.data.api.KnownPlayer
import dev.convocados.wear.data.api.KnownPlayersResponse
import dev.convocados.wear.data.api.WearApiClient
import dev.convocados.wear.data.local.KnownPlayersStore
import dev.convocados.wear.data.repository.AddPlayerOutcome
import dev.convocados.wear.data.repository.WearTeamRepository
import dev.convocados.wear.data.sync.ScoreSyncWorker
import kotlinx.coroutines.Job
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
    val queuedNames: Set<String> = emptySet(),
    /** A queued add is blocked on a sign-in, not just on the network. */
    val signInRequired: Boolean = false,
    val error: String? = null,
)

@HiltViewModel
class AddPlayerViewModel @Inject constructor(
    private val client: WearApiClient,
    private val repository: WearTeamRepository,
    private val knownStore: KnownPlayersStore,
    private val workManager: WorkManager,
) : ViewModel() {

    private val _uiState = MutableStateFlow(AddPlayerUiState())
    val uiState: StateFlow<AddPlayerUiState> = _uiState.asStateFlow()
    private var queuedJob: Job? = null

    fun load(eventId: String) {
        if (queuedJob == null) {
            queuedJob = viewModelScope.launch {
                repository.observePendingAddNames(eventId).collect { names ->
                    _uiState.update { it.copy(queuedNames = names.toSet()) }
                }
            }
        }
        viewModelScope.launch {
            // Offline the server list is unreachable; the last successful list
            // keeps the screen usable instead of showing "no known players".
            val cached = knownStore.load(eventId)
            _uiState.update { it.copy(known = cached, isLoading = cached.isEmpty(), error = null) }
            try {
                val res = client.get<KnownPlayersResponse>("/api/events/$eventId/known-players")
                knownStore.save(eventId, res.players)
                _uiState.update { it.copy(known = res.players, isLoading = false) }
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        error = if (cached.isEmpty()) e.message ?: "Failed to load" else null,
                    )
                }
            }
        }
    }

    fun add(eventId: String, name: String) {
        if (_uiState.value.adding != null || name in _uiState.value.queuedNames) return
        viewModelScope.launch {
            _uiState.update { it.copy(adding = name, error = null) }
            repository.addPlayer(eventId, name)
                .onSuccess { outcome ->
                    _uiState.update {
                        it.copy(
                            adding = null,
                            // A queued add stays listed and is labelled from the
                            // queue flow; a server add is now on the roster.
                            known = if (outcome == AddPlayerOutcome.ADDED) {
                                it.known.filterNot { k -> k.name == name }
                            } else {
                                it.known
                            },
                            signInRequired = outcome == AddPlayerOutcome.QUEUED_SIGN_IN_REQUIRED,
                        )
                    }
                    // Replay as soon as the watch reconnects instead of waiting
                    // for the 15-minute periodic job.
                    if (outcome != AddPlayerOutcome.ADDED) {
                        ScoreSyncWorker.enqueueOneTime(workManager)
                    }
                }
                .onFailure { e ->
                    _uiState.update { it.copy(adding = null, error = e.message ?: "Failed to add") }
                }
        }
    }
}