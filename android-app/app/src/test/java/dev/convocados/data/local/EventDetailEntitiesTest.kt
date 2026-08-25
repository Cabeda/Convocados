package dev.convocados.data.local

import dev.convocados.data.api.EventDetail
import dev.convocados.data.api.InviteChannels
import dev.convocados.data.api.RosterPlayer
import dev.convocados.data.local.entity.EntityJson
import dev.convocados.data.local.entity.toEntity
import org.junit.Assert.assertEquals
import org.junit.Test

class EventDetailEntitiesTest {

    @Test
    fun `EventDetail toEntity persists invited and declined as json`() {
        val ev = EventDetail(
            id = "e1",
            title = "T",
            location = "L",
            dateTime = "2024-01-01T10:00:00Z",
            maxPlayers = 10,
            players = emptyList(),
            ownerId = "u1",
            invited = listOf(
                RosterPlayer("i1", "Hugo", inviteId = "inv-1", channels = InviteChannels(email = true)),
            ),
            declined = listOf(RosterPlayer("d1", "Marco")),
        )

        val entity = ev.toEntity()

        val invitedBack = EntityJson.decodeFromString<List<RosterPlayer>>(
            checkNotNull(entity.invitedJson),
        )
        assertEquals("Hugo", invitedBack[0].name)
        assertEquals("inv-1", invitedBack[0].inviteId)
        assertEquals(true, invitedBack[0].channels.email)

        val declinedBack = EntityJson.decodeFromString<List<RosterPlayer>>(
            checkNotNull(entity.declinedJson),
        )
        assertEquals("Marco", declinedBack[0].name)
    }

    @Test
    fun `EventDetail toEntity stores empty invited list as null`() {
        val ev = EventDetail(
            id = "e2",
            title = "T",
            location = "L",
            dateTime = "2024-01-01T10:00:00Z",
            maxPlayers = 10,
            players = emptyList(),
            invited = emptyList(),
            declined = emptyList(),
        )

        val entity = ev.toEntity()

        assertEquals(null, entity.invitedJson)
        assertEquals(null, entity.declinedJson)
    }
}
