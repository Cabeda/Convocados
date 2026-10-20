package dev.convocados.wear.data.local

import android.content.Context
import android.content.SharedPreferences
import dev.convocados.wear.data.api.KnownPlayer
import io.mockk.*
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

class KnownPlayersStoreTest {

    private val prefs = mockk<SharedPreferences>(relaxed = true)
    private val editor = mockk<SharedPreferences.Editor>(relaxed = true)
    private lateinit var store: KnownPlayersStore

    @Before
    fun setup() {
        every { prefs.edit() } returns editor
        every { editor.putString(any(), any()) } returns editor
        val ctx = mockk<Context>(relaxed = true)
        every { ctx.getSharedPreferences(any(), any()) } returns prefs
        store = KnownPlayersStore(ctx)
    }

    @Test
    fun `save persists the list and load reads it back`() {
        val saved = slot<String>()
        every { editor.putString("e1", capture(saved)) } returns editor

        store.save("e1", listOf(KnownPlayer("Alice", gamesPlayed = 3)))

        every { prefs.getString("e1", null) } returns saved.captured
        assertEquals(listOf(KnownPlayer("Alice", gamesPlayed = 3)), store.load("e1"))
    }

    @Test
    fun `load returns empty when nothing was cached`() {
        every { prefs.getString("e1", null) } returns null

        assertTrue(store.load("e1").isEmpty())
    }

    @Test
    fun `load tolerates a corrupt cache instead of crashing`() {
        every { prefs.getString("e1", null) } returns "{not json"

        assertTrue(store.load("e1").isEmpty())
    }
}
