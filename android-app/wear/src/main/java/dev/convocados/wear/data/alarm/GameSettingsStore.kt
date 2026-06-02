package dev.convocados.wear.data.alarm

import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Device-local, per-event game settings (kickoff override + alarms), backed by
 * SharedPreferences and exposed as a reactive [StateFlow] so the score screen
 * reacts to changes made on the settings screen.
 */
@Singleton
class GameSettingsStore @Inject constructor(
    @ApplicationContext context: Context,
) {
    private val prefs = context.getSharedPreferences("game_settings", Context.MODE_PRIVATE)
    private val json = Json { ignoreUnknownKeys = true }
    private val flows = mutableMapOf<String, MutableStateFlow<GameSettings>>()

    fun settings(eventId: String): StateFlow<GameSettings> = flowFor(eventId)

    fun current(eventId: String): GameSettings = flowFor(eventId).value

    /** Atomically transform and persist this event's settings. */
    @Synchronized
    fun update(eventId: String, transform: (GameSettings) -> GameSettings): GameSettings {
        val flow = flowFor(eventId)
        val updated = transform(flow.value)
        flow.value = updated
        prefs.edit().putString(eventId, json.encodeToString(updated)).apply()
        return updated
    }

    @Synchronized
    private fun flowFor(eventId: String): MutableStateFlow<GameSettings> =
        flows.getOrPut(eventId) { MutableStateFlow(load(eventId)) }

    private fun load(eventId: String): GameSettings =
        prefs.getString(eventId, null)
            ?.let { runCatching { json.decodeFromString<GameSettings>(it) }.getOrNull() }
            ?: GameSettings()

    /** All persisted event settings (for boot-time rescheduling). */
    fun allSettings(): Map<String, GameSettings> = prefs.all.mapNotNull { (key, value) ->
        (value as? String)?.let { raw ->
            runCatching { json.decodeFromString<GameSettings>(raw) }.getOrNull()?.let { key to it }
        }
    }.toMap()
}
