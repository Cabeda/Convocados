package dev.convocados.ui.navigation

sealed class Route(val route: String) {
    data object Login : Route("login")
    data object Games : Route("games")
    data object Stats : Route("stats")
    data object Profile : Route("profile")
    data object CreateEvent : Route("create")
    data object PublicGames : Route("public-games")
    data object NotificationPrefs : Route("notification-prefs")
    data class EventDetail(val id: String = "{eventId}") : Route("event/{eventId}") {
        companion object { fun create(id: String) = "event/$id" }
    }
    data class EventSettings(val id: String = "{eventId}") : Route("event/{eventId}/settings") {
        companion object { fun create(id: String) = "event/$id/settings" }
    }
    data class EventRankings(val id: String = "{eventId}") : Route("event/{eventId}/rankings") {
        companion object { fun create(id: String) = "event/$id/rankings" }
    }
    data class EventPayments(val id: String = "{eventId}") : Route("event/{eventId}/payments") {
        companion object { fun create(id: String) = "event/$id/payments" }
    }
    data class EventAttendance(val id: String = "{eventId}") : Route("event/{eventId}/attendance") {
        companion object { fun create(id: String) = "event/$id/attendance" }
    }
    data class EventLog(val id: String = "{eventId}") : Route("event/{eventId}/log") {
        companion object { fun create(id: String) = "event/$id/log" }
    }
    data class UserProfile(val id: String = "{userId}") : Route("user/{userId}") {
        companion object { fun create(id: String) = "user/$id" }
    }
}
