package dev.convocados.wear.data.local

import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import javax.inject.Inject
import javax.inject.Singleton

/**
 * A quick game's live state (score, config, kickoff), persisted across app
 * exits so the timer stays anchored to when the game actually started. Backed
 * by SharedPreferences and exposed as a reactive [StateFlow]. Not tied to a
 * back-stack entry — a quick game survives the user leaving and returning.
 */
@Serializable
data class QuickGameState(
    val scoreOne: Int = 0,
    val scoreTwo: Int = 0,
    val durationMinutes: Int = 60,
    val alarmIntervalMinutes: Int = 10,
    val kickoffEpochMs: Long? = null,
) {
    val isStarted: Boolean get() = kickoffEpochMs != null

    /** True while now is inside [kickoff, kickoff + duration] — the game is live. */
    fun isLive(nowMs: Long): Boolean {
        val k = kickoffEpochMs ?: return false
        return nowMs in k..(k + durationMinutes * 60_000L)
    }
}

@Singleton
class QuickGameStore @Inject constructor(
    @ApplicationContext context: Context,
) {
    private val prefs = context.getSharedPreferences("quick_game", Context.MODE_PRIVATE)
    private val json = Json { ignoreUnknownKeys = true }

    private val _state = MutableStateFlow(load())
    val state: StateFlow<QuickGameState> = _state.asStateFlow()

    /** Atomically transform and persist the quick game. */
    @Synchronized
    fun update(transform: (QuickGameState) -> QuickGameState) {
        val updated = transform(_state.value)
        _state.value = updated
        prefs.edit().putString(KEY, json.encodeToString(updated)).apply()
    }

    @Synchronized
    fun clear() {
        _state.value = QuickGameState()
        prefs.edit().remove(KEY).apply()
    }

    private fun load(): QuickGameState =
        prefs.getString(KEY, null)
            ?.let { runCatching { json.decodeFromString<QuickGameState>(it) }.getOrNull() }
            ?: QuickGameState()

    companion object {
        private const val KEY = "state"
    }
}