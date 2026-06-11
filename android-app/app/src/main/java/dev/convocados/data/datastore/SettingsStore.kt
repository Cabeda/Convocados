package dev.convocados.data.datastore

import android.content.Context
import androidx.appcompat.app.AppCompatDelegate
import androidx.core.os.LocaleListCompat
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
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
}
