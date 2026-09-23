package dev.convocados.data.api

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class MatchEventModelsTest {
    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun `deserializes a match events response with a derived score`() {
        val payload = """
            {
              "events": [
                {
                  "id": "m1", "type": "goal", "team": "one", "minute": 12,
                  "ownGoal": false, "penalty": true,
                  "scorerEventPlayerId": "ep1", "scorerName": "Alice",
                  "assistEventPlayerId": "ep2", "assistName": "Bob",
                  "createdAt": "2026-01-01T10:00:00.000Z"
                }
              ],
              "score": { "teamOne": 1, "teamTwo": 0 },
              "scoringType": "standard"
            }
        """.trimIndent()

        val resp = json.decodeFromString<MatchEventsResponse>(payload)

        assertEquals(1, resp.events.size)
        val event = resp.events[0]
        assertEquals("goal", event.type)
        assertEquals("one", event.team)
        assertEquals(12, event.minute)
        assertTrue(event.penalty)
        assertEquals("Alice", event.scorerName)
        assertEquals("Bob", event.assistName)
        assertEquals(1, resp.score?.teamOne)
        assertEquals(0, resp.score?.teamTwo)
    }

    @Test
    fun `deserializes a response with no events and a null score`() {
        val resp = json.decodeFromString<MatchEventsResponse>(
            """{"events":[],"score":null,"scoringType":"standard"}""",
        )
        assertTrue(resp.events.isEmpty())
        assertNull(resp.score)
    }

    @Test
    fun `round-trips a goal request with its set fields`() {
        val body = MatchEventRequest(type = "goal", team = "two", scorerName = "Charlie")
        val encoded = json.encodeToString(MatchEventRequest.serializer(), body)
        val decoded = json.decodeFromString<MatchEventRequest>(encoded)
        assertEquals("goal", decoded.type)
        assertEquals("two", decoded.team)
        assertEquals("Charlie", decoded.scorerName)
        assertNull(decoded.minute)
        assertNull(decoded.assistName)
    }

    @Test
    fun `deserializes a scorer table`() {
        val resp = json.decodeFromString<MatchStatsResponse>(
            """{"scorers":[{"name":"Alice","eventPlayerId":"ep1","goals":2,"assists":1,"ownGoals":0,"penalties":0}],"scoringType":"standard"}""",
        )
        assertEquals(1, resp.scorers.size)
        assertEquals(2, resp.scorers[0].goals)
        assertEquals(1, resp.scorers[0].assists)
    }

    @Test
    fun `event stats carry goals and assists`() {
        val stats = json.decodeFromString<EventStats>(
            """{"eventId":"e1","eventTitle":"Test","goals":4,"assists":3}""",
        )
        assertEquals(4, stats.goals)
        assertEquals(3, stats.assists)
    }
}
