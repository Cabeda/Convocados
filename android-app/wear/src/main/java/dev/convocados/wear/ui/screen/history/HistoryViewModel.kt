package dev.convocados.wear.ui.screen.history

import androidx.compose.runtime.Immutable
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import dev.convocados.wear.data.local.entity.WearHistoryEntity
import dev.convocados.wear.data.repository.WearGameRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.launch
import javax.inject.Inject

@Immutable
data class HistoryUiState(
    val rows: List<HistoryRow> = emptyList(),
    val isLoading: Boolean = true,
)

@Immutable
data class HistoryRow(
    val historyId: String,
    val title: String,
    val dateTime: String,
    val scoreOne: Int?,
    val scoreTwo: Int?,
    val teamOneName: String,
    val teamTwoName: String,
)

@HiltViewModel
class HistoryViewModel @Inject constructor(
    private val repository: WearGameRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(HistoryUiState())
    val uiState: StateFlow<HistoryUiState> = _uiState.asStateFlow()

    init {
        viewModelScope.launch {
            val titles = repository.gameTitles()
            repository.observeAllHistory()
                .combine(kotlinx.coroutines.flow.flowOf(titles)) { history, gameTitles ->
                    history.map { h ->
                        HistoryRow(
                            historyId = h.id,
                            title = gameTitles[h.eventId] ?: h.eventId,
                            dateTime = h.dateTime,
                            scoreOne = h.scoreOne,
                            scoreTwo = h.scoreTwo,
                            teamOneName = h.teamOneName,
                            teamTwoName = h.teamTwoName,
                        )
                    }
                }
                .collect { rows ->
                    _uiState.value = HistoryUiState(rows = rows, isLoading = false)
                }
        }
    }
}