package dev.convocados.wear.data.alarm

import android.content.Context
import android.content.SharedPreferences
import io.mockk.*
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

class GameSettingsStoreTest {

    private val prefs = mockk<SharedPreferences>(relaxed = true)
    private val editor = mockk<SharedPreferences.Editor>(relaxed = true)
    private lateinit var store: GameSettingsStore

    @Before
    fun setup() {
        every { prefs.edit() } returns editor
        every { editor.putString(any(), any()) } returns editor
        every { editor.remove(any()) } returns editor
        val ctx = mockk<Context>(relaxed = true)
        every { ctx.getSharedPreferences(any(), any()) } returns prefs
        store = GameSettingsStore(ctx)
    }

    @Test
    fun `update persists and returns new settings`() {
        every { prefs.getString("e1", null) } returns null
        val result = store.update("e1") { it.copy(kickoffEpochMs = 12345L) }
        assertEquals(12345L, result.kickoffEpochMs)
        verify { editor.putString("e1", any()) }
    }

    @Test
    fun `current returns default for missing event`() {
        every { prefs.getString("missing", null) } returns null
        val s = store.current("missing")
        assertNull(s.kickoffEpochMs)
        assertTrue(s.alarms.isEmpty())
        assertTrue(s.keepScreenOn)
        assertFalse(s.vibrationEnabled)
        assertEquals(5, s.vibrationIntervalMinutes)
    }

    @Test
    fun `update changes keepScreenOn value`() {
        every { prefs.getString("e1", null) } returns null
        val result = store.update("e1") { it.copy(keepScreenOn = false) }
        assertFalse(result.keepScreenOn)
        verify { editor.putString("e1", any()) }
    }

    @Test
    fun `allSettings skips corrupt entries without crashing`() {
        val recent = System.currentTimeMillis() - 10 * 60_000L
        every { prefs.all } returns mapOf(
            "good" to """{"scheduledKickoffMs":$recent,"durationMinutes":60,"alarms":[]}""",
            "corrupt" to "not json",
            "nonstring" to 42,
        )
        val all = store.allSettings()
        assertEquals(1, all.size)
        assertTrue(all.containsKey("good"))
    }

    @Test
    fun `allSettings prunes entries whose game ended more than 24h ago`() {
        val now = System.currentTimeMillis()
        val staleKickoff = now - 48 * 3600_000L // 2 days ago
        val freshKickoff = now - 30 * 60_000L   // 30 min ago

        every { prefs.all } returns mapOf(
            "stale" to """{"scheduledKickoffMs":$staleKickoff,"durationMinutes":60,"alarms":[]}""",
            "fresh" to """{"scheduledKickoffMs":$freshKickoff,"durationMinutes":60,"alarms":[]}""",
        )
        val all = store.allSettings()
        assertEquals(1, all.size)
        assertTrue(all.containsKey("fresh"))
        verify { editor.remove("stale") }
    }
}
