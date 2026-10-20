package dev.convocados.wear.data.local

import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import dev.convocados.wear.data.api.KnownPlayer
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Last successful known-players list per event, so the add-player screen stays
 * usable when the watch is offline (#1343). SharedPreferences, like
 * [dev.convocados.wear.data.alarm.GameSettingsStore].
 */
@Singleton
class KnownPlayersStore @Inject constructor(
    @ApplicationContext context: Context,
) {
    private val prefs = context.getSharedPreferences("known_players", Context.MODE_PRIVATE)
    private val json = Json { ignoreUnknownKeys = true }

    fun load(eventId: String): List<KnownPlayer> =
        prefs.getString(eventId, null)
            ?.let { runCatching { json.decodeFromString<List<KnownPlayer>>(it) }.getOrNull() }
            ?: emptyList()

    fun save(eventId: String, players: List<KnownPlayer>) {
        prefs.edit().putString(eventId, json.encodeToString(players)).apply()
    }
}
