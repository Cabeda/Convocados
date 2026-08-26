package dev.convocados.wear.data.local

import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Device-local "arrived" flags per player (keyed playerId). Check-in is tracked
 * on the wrist for the organizer during a session; it is not pushed to the
 * server yet (server-backed attendance is a follow-up).
 */
@Singleton
class CheckInStore @Inject constructor(
    @ApplicationContext context: Context,
) {
    private val prefs = context.getSharedPreferences("checkin", Context.MODE_PRIVATE)

    private val _arrived = MutableStateFlow(
        prefs.all.filterValues { it == true }.keys.toSet(),
    )
    val arrived: StateFlow<Set<String>> = _arrived.asStateFlow()

    @Synchronized
    fun toggle(playerId: String) {
        val next = if (playerId in _arrived.value) _arrived.value - playerId else _arrived.value + playerId
        _arrived.value = next
        prefs.edit().putBoolean(playerId, playerId in next).apply()
    }
}