package dev.convocados.wear.ui.navigation

/** Wear OS navigation routes. */
object WearRoutes {
    const val AUTH = "auth"
    const val GAMES = "games"
    const val SCORE = "score/{eventId}"

    fun score(eventId: String) = "score/$eventId"
}
