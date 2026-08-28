package dev.convocados.wear.ui.navigation

/** Wear OS navigation routes. */
object WearRoutes {
    const val AUTH = "auth"
    const val GAMES = "games"
    const val SCORE = "score/{eventId}"
    const val TEAMS = "teams/{eventId}"
    const val ADD_PLAYER = "teams/{eventId}/add-player"
    const val QUICK_SETUP = "quick_setup"
    const val QUICK_SCORE = "quick_score"
    const val SAVE_QUICK = "save_quick"
    const val HISTORY = "history"
    const val MVP = "mvp/{eventId}/{historyId}"

    fun score(eventId: String) = "score/$eventId"
    fun mvp(eventId: String, historyId: String) = "mvp/$eventId/$historyId"
    fun teams(eventId: String) = "teams/$eventId"
    fun addPlayer(eventId: String) = "teams/$eventId/add-player"
}
