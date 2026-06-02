package dev.convocados.wear.ui.screen.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import dev.convocados.wear.data.alarm.AlarmType
import dev.convocados.wear.data.alarm.GameAlarm
import dev.convocados.wear.data.alarm.GameAlarmScheduler
import dev.convocados.wear.data.alarm.GameSettings
import dev.convocados.wear.data.alarm.GameSettingsStore
import dev.convocados.wear.data.alarm.computeAlarmTimes
import dev.convocados.wear.data.repository.WearGameRepository
import dev.convocados.wear.util.parseInstant
import dev.convocados.wear.util.sportDurationMinutes
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.util.UUID
import javax.inject.Inject

data class GameSettingsUiState(
    val isLoading: Boolean = true,
    val kickoffEpochMs: Long = 0,
    val isKickoffOverridden: Boolean = false,
    val alarms: List<GameAlarm> = emptyList(),
    val canScheduleExact: Boolean = true,
)

@HiltViewModel
class GameSettingsViewModel @Inject constructor(
    private val gameRepository: WearGameRepository,
    private val store: GameSettingsStore,
    private val scheduler: GameAlarmScheduler,
) : ViewModel() {

    private val _uiState = MutableStateFlow(GameSettingsUiState())
    val uiState: StateFlow<GameSettingsUiState> = _uiState.asStateFlow()

    private var eventId: String = ""
    private var scheduledKickoffMs: Long = System.currentTimeMillis()
    private var durationMinutes: Int = 60

    fun load(eventId: String) {
        if (this.eventId == eventId) return
        this.eventId = eventId
        viewModelScope.launch {
            val game = gameRepository.getGame(eventId)
            scheduledKickoffMs = game?.dateTime?.let { parseInstant(it)?.toEpochMilli() }
                ?: System.currentTimeMillis()
            durationMinutes = game?.let { sportDurationMinutes(it.sport) } ?: 60
            store.settings(eventId).collect { s ->
                _uiState.value = GameSettingsUiState(
                    isLoading = false,
                    kickoffEpochMs = effectiveKickoff(s),
                    isKickoffOverridden = s.kickoffEpochMs != null,
                    alarms = s.alarms,
                    canScheduleExact = scheduler.canScheduleExact(),
                )
            }
        }
    }

    fun kickoffNow() = apply { it.copy(kickoffEpochMs = System.currentTimeMillis()) }

    fun nudgeKickoff(deltaMinutes: Int) = apply {
        it.copy(kickoffEpochMs = (it.kickoffEpochMs ?: scheduledKickoffMs) + deltaMinutes * 60_000L)
    }

    fun resetKickoff() = apply { it.copy(kickoffEpochMs = null) }

    fun addRecurring(minute: Int = 5) = apply {
        it.copy(alarms = it.alarms + newAlarm(it.alarms, AlarmType.RECURRING, minute))
    }

    fun addSingle(minute: Int = 25) = apply {
        it.copy(alarms = it.alarms + newAlarm(it.alarms, AlarmType.SINGLE, minute))
    }

    fun toggleAlarm(id: String) = apply {
        it.copy(alarms = it.alarms.map { a -> if (a.id == id) a.copy(enabled = !a.enabled) else a })
    }

    fun changeMinute(id: String, delta: Int) = apply {
        it.copy(alarms = it.alarms.map { a -> if (a.id == id) a.copy(minute = (a.minute + delta).coerceIn(1, 120)) else a })
    }

    fun removeAlarm(id: String) = apply {
        it.copy(alarms = it.alarms.filterNot { a -> a.id == id })
    }

    private fun newAlarm(existing: List<GameAlarm>, type: AlarmType, minute: Int) =
        GameAlarm(UUID.randomUUID().toString(), type, minute, pulses = (existing.size % 3) + 1)

    private fun effectiveKickoff(s: GameSettings): Long = s.kickoffEpochMs ?: scheduledKickoffMs

    /** Persist a change and re-schedule all alarms from the (possibly new) kickoff. */
    private fun apply(transform: (GameSettings) -> GameSettings) {
        val updated = store.update(eventId, transform)
        scheduler.reschedule(
            eventId,
            computeAlarmTimes(effectiveKickoff(updated), updated.alarms, durationMinutes, System.currentTimeMillis()),
        )
    }
}
