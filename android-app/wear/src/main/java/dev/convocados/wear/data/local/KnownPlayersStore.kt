package dev.convocados.wear.data.local

import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import dev.convocados.wear.data.api.KnownPlayer
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Last successful known-players list, so the add-player screen stays usable
 * when the watch is offline (#1343). SharedPreferences, like
 * [dev.convocados.wear.data.alarm.GameSettingsStore].
 *
 * One entry only: a watch plays one event at a time, and a per-event map would
 * grow forever. Signing out leaves at most this one event's names behind.
 */
@Singleton
class KnownPlayersStore @Inject constructor(
    @ApplicationContext context: Context,
) {
    private val prefs = context.getSharedPreferences("known_players", Context.MODE_PRIVATE)
    private val json = Json { ignoreUnknownKeys = true }

    fun load(eventId: String): List<KnownPlayer> {
        val raw = prefs.getString(KEY, null) ?: return emptyList()
        val cached = runCatching { json.decodeFromString<CachedKnownPlayers>(raw) }.getOrNull()
        return if (cached?.eventId == eventId) cached.players else emptyList()
    }

    fun save(eventId: String, players: List<KnownPlayer>) {
        prefs.edit().putString(KEY, json.encodeToString(CachedKnownPlayers(eventId, players))).apply()
    }

    private companion object {
        const val KEY = "last"
    }
}

@Serializable
private data class CachedKnownPlayers(val eventId: String, val players: List<KnownPlayer>)
