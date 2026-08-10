package dev.convocados.data.api

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ModelsTest {

    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun `decodes profile image on a linked player`() {
        val player = json.decodeFromString<Player>(
            """{"id":"p1","name":"Alice","order":0,"userId":"u1","image":"https://example.com/alice.jpg","createdAt":""}"""
        )
        assertEquals("https://example.com/alice.jpg", player.image)
    }

    @Test
    fun `defaults image to null when absent`() {
        val player = json.decodeFromString<Player>(
            """{"id":"p1","name":"Alice","order":0,"userId":"u1","createdAt":""}"""
        )
        assertNull(player.image)
    }
}
