package dev.convocados.data.datastore

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

private val Context.dataStore by preferencesDataStore("settings")

@Singleton
class SettingsStore @Inject constructor(@ApplicationContext private val context: Context) {

    private val LOCALE_KEY = stringPreferencesKey("locale")

    val locale: Flow<String> = context.dataStore.data.map { it[LOCALE_KEY] ?: "en" }

    suspend fun setLocale(locale: String) {
        context.dataStore.edit { it[LOCALE_KEY] = locale }
    }
}
