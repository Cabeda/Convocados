package dev.convocados.data.datastore

import android.content.Context
import androidx.appcompat.app.AppCompatDelegate
import androidx.core.os.LocaleListCompat
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.core.stringSetPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import dagger.hilt.android.qualifiers.ApplicationContext
import dev.convocados.ui.theme.ThemeMode
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

private val Context.dataStore by preferencesDataStore("settings")

@Singleton
class SettingsStore @Inject constructor(@ApplicationContext private val context: Context) {

    private val LOCALE_KEY = stringPreferencesKey("locale")
    private val THEME_KEY = stringPreferencesKey("theme_mode")
    private val AUTO_PAY_ON_JOIN_KEY = booleanPreferencesKey("auto_pay_on_join")
    private val DYNAMIC_COLOR_KEY = booleanPreferencesKey("dynamic_color")
    // Post-game Season Rank reveals the viewer has dismissed, keyed by the
    // GameHistory id of the game the reveal described. A Set so dismissing one
    // game's reveal never suppresses another's.
    private val DISMISSED_RANK_REVEALS_KEY = stringSetPreferencesKey("dismissed_rank_reveals")
    // Whether the POST_NOTIFICATIONS runtime dialog was already attempted —
    // needed to tell "never asked" (OFF) from "permanently denied" (BLOCKED),
    // since shouldShowRationale is false in both cases before the first ask.
    private val NOTIF_PERM_REQUESTED_KEY = booleanPreferencesKey("notification_permission_requested")

    val locale: Flow<String> = context.dataStore.data.map { it[LOCALE_KEY] ?: "en" }

    suspend fun setLocale(locale: String) {
        context.dataStore.edit { it[LOCALE_KEY] = locale }
        val localeList = LocaleListCompat.forLanguageTags(locale)
        AppCompatDelegate.setApplicationLocales(localeList)
    }

    val themeMode: Flow<ThemeMode> = context.dataStore.data.map { prefs ->
        when (prefs[THEME_KEY]) {
            "light" -> ThemeMode.Light
            "dark" -> ThemeMode.Dark
            else -> ThemeMode.System
        }
    }

    suspend fun setThemeMode(mode: ThemeMode) {
        context.dataStore.edit { prefs ->
            prefs[THEME_KEY] = when (mode) {
                ThemeMode.Light -> "light"
                ThemeMode.Dark -> "dark"
                ThemeMode.System -> "system"
            }
        }
    }

    val autoPayOnJoin: Flow<Boolean> = context.dataStore.data.map { it[AUTO_PAY_ON_JOIN_KEY] ?: false }

    suspend fun setAutoPayOnJoin(enabled: Boolean) {
        context.dataStore.edit { it[AUTO_PAY_ON_JOIN_KEY] = enabled }
    }

    /** Material You dynamic color (Android 12+). Defaults off to preserve brand palette. */
    val dynamicColor: Flow<Boolean> = context.dataStore.data.map { it[DYNAMIC_COLOR_KEY] ?: false }

    suspend fun setDynamicColor(enabled: Boolean) {
        context.dataStore.edit { it[DYNAMIC_COLOR_KEY] = enabled }
    }

    /** GameHistory ids whose post-game Season Rank reveal has been dismissed. */
    val dismissedRankReveals: Flow<Set<String>> =
        context.dataStore.data.map { it[DISMISSED_RANK_REVEALS_KEY] ?: emptySet() }

    suspend fun dismissRankReveal(historyId: String) {
        context.dataStore.edit { prefs ->
            prefs[DISMISSED_RANK_REVEALS_KEY] = (prefs[DISMISSED_RANK_REVEALS_KEY] ?: emptySet()) + historyId
        }
    }

    /** True once the notification permission dialog has been attempted at least once. */
    val notificationPermissionRequested: Flow<Boolean> =
        context.dataStore.data.map { it[NOTIF_PERM_REQUESTED_KEY] ?: false }

    suspend fun markNotificationPermissionRequested() {
        context.dataStore.edit { it[NOTIF_PERM_REQUESTED_KEY] = true }
    }
}
