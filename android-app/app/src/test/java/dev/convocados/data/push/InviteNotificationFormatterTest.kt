package dev.convocados.data.push

import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.ZoneId

/**
 * The invite notification must carry enough context (sport · local kickoff
 * time · place) for the user to accept/decline without opening the app.
 */
class InviteNotificationFormatterTest {

    private val lisbon = ZoneId.of("Europe/Lisbon")

    @Test
    fun `detail line joins sport local time and location`() {
        val line = InviteNotificationFormatter.buildDetailLine(
            sport = "football-5v5",
            startsAt = "2026-08-25T10:00:00Z",
            location = "Estádio do Bessa",
            zoneId = lisbon, // UTC+1 in summer → 11:00 local
        )
        assertEquals("Football 5v5 · Tue 25 Aug, 11:00 · Estádio do Bessa", line)
    }

    @Test
    fun `blank location is omitted`() {
        val line = InviteNotificationFormatter.buildDetailLine(
            sport = "padel", startsAt = "2026-08-25T10:00:00Z", location = "  ", zoneId = lisbon,
        )
        assertEquals("Padel · Tue 25 Aug, 11:00", line)
    }

    @Test
    fun `unparseable time is skipped and remaining parts kept`() {
        val line = InviteNotificationFormatter.buildDetailLine(
            sport = "tennis", startsAt = "not-a-date", location = "Court 1", zoneId = lisbon,
        )
        assertEquals("Tennis · Court 1", line)
    }

    @Test
    fun `all blank inputs yield empty line`() {
        val line = InviteNotificationFormatter.buildDetailLine(null, null, null, zoneId = lisbon)
        assertEquals("", line)
    }

    @Test
    fun `sport id is humanized`() {
        assertEquals("Football 5v5", InviteNotificationFormatter.humanizeSport("football-5v5"))
        assertEquals("Beach Volley", InviteNotificationFormatter.humanizeSport("beach-volley"))
        assertEquals("Padel", InviteNotificationFormatter.humanizeSport("padel"))
    }

    @Test
    fun `big text stacks invite body over details`() {
        val out = InviteNotificationFormatter.buildBigText("José invited you to play", "Padel · Court 1")
        assertEquals("José invited you to play\nPadel · Court 1", out)
    }
}
