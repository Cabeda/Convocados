package dev.convocados.wear.ui.screen.teams

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.work.WorkManager
import dagger.hilt.android.lifecycle.HiltViewModel
import dev.convocados.wear.data.local.entity.WearPlayerEntity
import dev.convocados.wear.data.repository.WearGameRepository
import dev.convocados.wear.data.sync.ScoreSyncWorker
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject

data class TeamsUiState(
    val teamOneName: String = "Team 1",
    val teamTwoName: String = "Team 2",
    val teamOnePlayers: List<WearPlayerEntity> = emptyList(),
    val teamTwoPlayers: List<WearPlayerEntity> = emptyList(),
    val unassigned: List<WearPlayerEntity> = emptyList(),
    val bench: List<WearPlayerEntity> = emptyList(),
    val isLoading: Boolean = true,
    val isSaving: Boolean = false,
    val saved: Boolean = false,
    val error: String? = null,
)

@HiltViewModel
class TeamsViewModel @Inject constructor(
    private val repository: WearGameRepository,
    private val workManager: WorkManager,
) : ViewModel() {

    private val _uiState = MutableStateFlow(TeamsUiState())
    val uiState: StateFlow<TeamsUiState> = _uiState.asStateFlow()

    private var eventId: String = ""

    fun load(eventId: String) {
        if (this.eventId == eventId && !_uiState.value.isLoading) return
        this.eventId = eventId

        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }

            // Refresh from API first
            repository.refreshTeams(eventId)

            // Then observe local cache
            repository.observePlayers(eventId).collect { players ->
                _uiState.update { state ->
                    state.copy(
                        teamOnePlayers = players.filter { it.teamAssignment == "teamOne" }.sortedBy { it.order },
                        teamTwoPlayers = players.filter { it.teamAssignment == "teamTwo" }.sortedBy { it.order },
                        unassigned = players.filter { it.teamAssignment == "unassigned" }.sortedBy { it.order },
                        bench = players.filter { it.teamAssignment == "bench" }.sortedBy { it.order },
                        isLoading = false,
                    )
                }
            }
        }
    }

    fun movePlayerToTeamOne(player: WearPlayerEntity) {
        val current = _uiState.value
        val optimisticState = current.copy(
            teamOnePlayers = (current.teamOnePlayers + player.copy(teamAssignment = "teamOne")).sortedBy { it.order },
            unassigned = current.unassigned.filter { it.id != player.id },
            teamTwoPlayers = current.teamTwoPlayers.filter { it.id != player.id },
            isSaving = true,
            error = null,
        )
        _uiState.value = optimisticState

        val teamOneIds = optimisticState.teamOnePlayers.map { it.id }
        val teamTwoIds = optimisticState.teamTwoPlayers.map { it.id }

        syncRoster(teamOneIds, teamTwoIds)
    }

    fun movePlayerToTeamTwo(player: WearPlayerEntity) {
        val current = _uiState.value
        val optimisticState = current.copy(
            teamTwoPlayers = (current.teamTwoPlayers + player.copy(teamAssignment = "teamTwo")).sortedBy { it.order },
            unassigned = current.unassigned.filter { it.id != player.id },
            teamOnePlayers = current.teamOnePlayers.filter { it.id != player.id },
            isSaving = true,
            error = null,
        )
        _uiState.value = optimisticState

        val teamOneIds = optimisticState.teamOnePlayers.map { it.id }
        val teamTwoIds = optimisticState.teamTwoPlayers.map { it.id }

        syncRoster(teamOneIds, teamTwoIds)
    }

    fun movePlayerToUnassigned(player: WearPlayerEntity) {
        val current = _uiState.value
        val optimisticState = current.copy(
            unassigned = (current.unassigned + player.copy(teamAssignment = "unassigned")).sortedBy { it.order },
            teamOnePlayers = current.teamOnePlayers.filter { it.id != player.id },
            teamTwoPlayers = current.teamTwoPlayers.filter { it.id != player.id },
            isSaving = true,
            error = null,
        )
        _uiState.value = optimisticState

        val teamOneIds = optimisticState.teamOnePlayers.map { it.id }
        val teamTwoIds = optimisticState.teamTwoPlayers.map { it.id }

        syncRoster(teamOneIds, teamTwoIds)
    }

    private fun syncRoster(teamOneIds: List<String>, teamTwoIds: List<String>) {
        viewModelScope.launch {
            val result = repository.updateTeams(eventId, teamOneIds, teamTwoIds)
            ScoreSyncWorker.enqueueOneTime(workManager)
            _uiState.update {
                it.copy(
                    isSaving = false,
                    saved = result.isSuccess,
                    error = result.exceptionOrNull()?.message,
                )
            }
        }
    }
}