package dev.convocados.ui.fixture

import dev.convocados.data.api.EventDetail
import dev.convocados.data.api.EventStats
import dev.convocados.data.api.EventSummary
import dev.convocados.data.api.Player
import dev.convocados.data.api.PlayerStats
import dev.convocados.data.api.StatsSummary
import dev.convocados.data.api.UserProfile

object FixtureData {
    private const val nextGame = "2026-09-12T18:30:00Z"

    val games = listOf(
        EventSummary("fixture-tuesday", "Tuesday Football", "Campo Central", nextGame, "football", 14, 10, lastScoreOne = 5, lastScoreTwo = 3),
        EventSummary("fixture-padel", "Friday Padel", "Club Norte", "2026-09-14T19:00:00Z", "padel", 8, 6, isRecurring = true),
        EventSummary("fixture-live", "Sunday Basketball", "Court 2", "2026-09-08T17:00:00Z", "basketball", 10, 10, lastScoreOne = 62, lastScoreTwo = 58),
    )

    val stats = PlayerStats(
        summary = StatsSummary(totalGames = 42, totalWins = 25, totalDraws = 5, totalLosses = 12, winRate = 0.595, avgRating = 1284, bestRating = 1392),
        events = listOf(
            EventStats("fixture-tuesday", "Tuesday Football", "football", 1320, 18, 12, 2, 4, 0.67),
            EventStats("fixture-padel", "Friday Padel", "padel", 1248, 14, 8, 2, 4, 0.57),
            EventStats("fixture-live", "Sunday Basketball", "basketball", 1284, 10, 5, 1, 4, 0.5),
        ),
    )

    val user = UserProfile("fixture-user", "Alex Convocados", "alex@example.test")

    val event = EventDetail(
        id = "fixture-tuesday",
        title = "Tuesday Football",
        location = "Campo Central",
        dateTime = nextGame,
        timezone = "Europe/Madrid",
        maxPlayers = 14,
        sport = "football",
        durationMinutes = 90,
        isPublic = true,
        isRecurring = true,
        ownerId = user.id,
        ownerName = user.name,
        isAdmin = true,
        players = listOf(
            Player("p1", "Alex Convocados", 0, userId = user.id),
            Player("p2", "Marta Silva", 1),
            Player("p3", "João Costa", 2),
            Player("p4", "Sam Taylor", 3),
        ),
    )
}
