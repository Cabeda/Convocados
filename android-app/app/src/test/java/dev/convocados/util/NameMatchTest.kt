package dev.convocados.util

import dev.convocados.data.api.Player
import dev.convocados.data.api.UserProfile
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NameMatchTest {

    private val viewer = UserProfile(id = "u-1", name = "José Silva", email = "jose@example.com")

    private fun row(id: String, name: String, userId: String? = null) = Player(id = id, name = name, order = 0, userId = userId)

    @Test
    fun `normalizeForMatch strips accents and lowercases like the web`() {
        assertEquals("jose silva", normalizeForMatch("José Silva"))
        assertEquals("jose silva", normalizeForMatch("JOSE SILVA"))
        assertEquals("muller", normalizeForMatch("Müller"))
    }

    @Test
    fun `prefers the linked row whatever the row is called`() {
        val rows = listOf(row("p-a", "Ze", "u-1"), row("p-b", "José Silva"))
        assertEquals("p-a", findSelfRosterRow(rows, viewer)?.id)
    }

    @Test
    fun `falls back to an unlinked row whose normalized name matches`() {
        val rows = listOf(row("p-a", "Bob"), row("p-b", "Jose SILVA"))
        assertEquals("p-b", findSelfRosterRow(rows, viewer)?.id)
    }

    @Test
    fun `returns null when no roster row matches`() {
        assertNull(findSelfRosterRow(listOf(row("p-a", "Bob")), viewer))
    }

    @Test
    fun `never matches a row already linked to a different account`() {
        val rows = listOf(row("p-a", "José Silva", "u-someone-else"))
        assertNull(findSelfRosterRow(rows, viewer))
    }

    @Test
    fun `returns null without a signed-in user`() {
        assertNull(findSelfRosterRow(listOf(row("p-a", "José Silva")), null))
    }

    @Test
    fun `the matched row is unlinked, so the existing X rule already allowed it`() {
        val matched = findSelfRosterRow(listOf(row("p-a", "José Silva")), viewer)
        assertTrue(matched != null && matched.userId == null)
    }
}
