package dev.convocados.wear.ui.screen.teams

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.work.WorkManager
import dagger.hilt.android.lifecycle.HiltViewModel
import dev.convocados.wear.data.local.entity.WearPlayerEntity
import dev.convocados.wear.data.repository.WearGameRepository
import dev.convocados.wear.data.repository.WearTeamRepository
import dev.convocados.wear.data.sync.ScoreSyncWorker
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
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
    val isReadOnly: Boolean = false, // true when showing snapshot from active game
    val error: String? = null,
)

@Serializable
private data class SnapshotTeam(
    val team: String = "",
    val players: List<SnapshotPlayer> = emptyList(),
)

@Serializable
private data class SnapshotPlayer(val name: String, val order: Int = 0)

@HiltViewModel
class TeamsViewModel @Inject constructor(
    private val repository: WearTeamRepository,
    private val gameRepository: WearGameRepository,
    private val workManager: WorkManager,
) : ViewModel() {

    private val _uiState = MutableStateFlow(TeamsUiState())
    val uiState: StateFlow<TeamsUiState> = _uiState.asStateFlow()

    private var eventId: String = ""
    private val json = Json { ignoreUnknownKeys = true }

    fun load(eventId: String) {
        if (this.eventId == eventId && !_uiState.value.isLoading) return
        this.eventId = eventId

        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }

            // Check if there's an active (editable) history with a teams snapshot
            val activeHistory = gameRepository.getLatestEditableHistory(eventId)
            val snapshot = activeHistory?.teamsSnapshot

            if (snapshot != null) {
                // Show snapshot teams from the active game (read-only)
                showSnapshotTeams(snapshot, activeHistory.teamOneName, activeHistory.teamTwoName)
            } else {
                // No active game — show live roster (editable for upcoming game)
                showLiveRoster(eventId)
            }
        }
    }

    private fun showSnapshotTeams(snapshot: String, teamOneName: String, teamTwoName: String) {
        val teams = try {
            json.decodeFromString<List<SnapshotTeam>>(snapshot)
        } catch (_: Exception) {
            _uiState.update { it.copy(isLoading = false, isReadOnly = true) }
            return
        }

        val teamOne = teams.getOrNull(0)
        val teamTwo = teams.getOrNull(1)

        _uiState.update {
            it.copy(
                teamOneName = teamOne?.team?.ifBlank { teamOneName } ?: teamOneName,
                teamTwoName = teamTwo?.team?.ifBlank { teamTwoName } ?: teamTwoName,
                teamOnePlayers = teamOne?.players?.mapIndexed { i, p ->
                    WearPlayerEntity(id = "snap-t1-$i", eventId = eventId, name = p.name, order = p.order, teamAssignment = "teamOne")
                } ?: emptyList(),
                teamTwoPlayers = teamTwo?.players?.mapIndexed { i, p ->
                    WearPlayerEntity(id = "snap-t2-$i", eventId = eventId, name = p.name, order = p.order, teamAssignment = "teamTwo")
                } ?: emptyList(),
                unassigned = emptyList(),
                bench = emptyList(),
                isLoading = false,
                isReadOnly = true,
            )
        }
    }

    private fun showLiveRoster(eventId: String) {
        viewModelScope.launch {
            // Observe local cache immediately
            launch {
                repository.observePlayers(eventId).collect { players ->
                    _uiState.update { state ->
                        state.copy(
                            teamOnePlayers = players.filter { it.teamAssignment == "teamOne" }.sortedBy { it.order },
                            teamTwoPlayers = players.filter { it.teamAssignment == "teamTwo" }.sortedBy { it.order },
                            unassigned = players.filter { it.teamAssignment == "unassigned" }.sortedBy { it.order },
                            bench = players.filter { it.teamAssignment == "bench" }.sortedBy { it.order },
                            isLoading = false,
                            isReadOnly = false,
                        )
                    }
                }
            }
            // Non-blocking refresh from API
            launch { repository.refreshTeams(eventId) }
        }
    }

    fun movePlayerToTeamOne(player: WearPlayerEntity) {
        if (_uiState.value.isReadOnly) return
        val current = _uiState.value
        val optimisticState = current.copy(
            teamOnePlayers = (current.teamOnePlayers + player.copy(teamAssignment = "teamOne")).sortedBy { it.order },
            unassigned = current.unassigned.filter { it.id != player.id },
            teamTwoPlayers = current.teamTwoPlayers.filter { it.id != player.id },
            isSaving = true,
            error = null,
        )
        _uiState.value = optimisticState
        syncRoster(optimisticState.teamOnePlayers.map { it.id }, optimisticState.teamTwoPlayers.map { it.id })
    }

    fun movePlayerToTeamTwo(player: WearPlayerEntity) {
        if (_uiState.value.isReadOnly) return
        val current = _uiState.value
        val optimisticState = current.copy(
            teamTwoPlayers = (current.teamTwoPlayers + player.copy(teamAssignment = "teamTwo")).sortedBy { it.order },
            unassigned = current.unassigned.filter { it.id != player.id },
            teamOnePlayers = current.teamOnePlayers.filter { it.id != player.id },
            isSaving = true,
            error = null,
        )
        _uiState.value = optimisticState
        syncRoster(optimisticState.teamOnePlayers.map { it.id }, optimisticState.teamTwoPlayers.map { it.id })
    }

    fun movePlayerToUnassigned(player: WearPlayerEntity) {
        if (_uiState.value.isReadOnly) return
        val current = _uiState.value
        val optimisticState = current.copy(
            unassigned = (current.unassigned + player.copy(teamAssignment = "unassigned")).sortedBy { it.order },
            teamOnePlayers = current.teamOnePlayers.filter { it.id != player.id },
            teamTwoPlayers = current.teamTwoPlayers.filter { it.id != player.id },
            isSaving = true,
            error = null,
        )
        _uiState.value = optimisticState
        syncRoster(optimisticState.teamOnePlayers.map { it.id }, optimisticState.teamTwoPlayers.map { it.id })
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
