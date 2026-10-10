package dev.convocados.ui.screen.event

/**
 * Formation slot within a team's own half.
 *
 * @param x depth from the team's own goal line (0) to the halfway line (1).
 * @param y width across the team's half: 0 = top touchline, 1 = bottom touchline.
 */
data class FormationSlot(val x: Float, val y: Float)

/** A named formation and the fixed points its players occupy. */
data class Formation(val id: String, val slots: List<FormationSlot>)

private fun rowsToSlots(rows: List<Int>): List<FormationSlot> {
    val slots = mutableListOf<FormationSlot>()
    val rowCount = rows.size
    rows.forEachIndexed { rowIdx, count ->
        val x = if (rowCount == 1) 0.5f else 0.15f + (rowIdx.toFloat() / (rowCount - 1)) * 0.7f
        for (i in 0 until count) {
            val y = if (count == 1) 0.5f else 0.12f + (i.toFloat() / (count - 1)) * 0.76f
            slots.add(FormationSlot(x, y))
        }
    }
    return slots
}

private fun formation(id: String, rows: List<Int>): Formation = Formation(id, rowsToSlots(rows))

private val SPORT_FORMATIONS: Map<String, List<Formation>> = mapOf(
    "football-5v5" to listOf(
        formation("2-2", listOf(1, 2, 2)),
        formation("1-2-1", listOf(1, 1, 2, 1)),
        formation("3-1", listOf(1, 3, 1)),
    ),
    "football-7v7" to listOf(
        formation("2-3-1", listOf(1, 2, 3, 1)),
        formation("3-2-1", listOf(1, 3, 2, 1)),
        formation("2-2-2", listOf(1, 2, 2, 2)),
    ),
    "football-11v11" to listOf(
        formation("4-4-2", listOf(1, 4, 4, 2)),
        formation("4-3-3", listOf(1, 4, 3, 3)),
        formation("4-2-4", listOf(1, 4, 2, 4)),
        formation("3-5-2", listOf(1, 3, 5, 2)),
        formation("4-5-1", listOf(1, 4, 5, 1)),
    ),
    "futsal" to listOf(
        formation("2-2", listOf(1, 2, 2)),
        formation("1-2-1", listOf(1, 1, 2, 1)),
        formation("3-1", listOf(1, 3, 1)),
    ),
    "basketball" to listOf(
        formation("2-1-2", listOf(2, 1, 2)),
        formation("1-2-2", listOf(1, 2, 2)),
        formation("2-2-1", listOf(2, 2, 1)),
    ),
    "volleyball" to listOf(
        formation("3-3", listOf(3, 3)),
        formation("2-2-2", listOf(2, 2, 2)),
    ),
    "padel" to listOf(formation("2", listOf(2))),
    "tennis-doubles" to listOf(formation("2", listOf(2))),
    "badminton-doubles" to listOf(formation("2", listOf(2))),
    "pickleball" to listOf(formation("2-2", listOf(2, 2))),
    "tennis-singles" to listOf(formation("1", listOf(1))),
    "badminton-singles" to listOf(formation("1", listOf(1))),
    "squash" to listOf(formation("1", listOf(1))),
    "other" to listOf(
        formation("2-2-1", listOf(2, 2, 1)),
        formation("2-1-2", listOf(2, 1, 2)),
    ),
)

private val FALLBACK = SPORT_FORMATIONS.getValue("other")

/** Formations available for a sport, falling back to a generic set. */
fun formationsForSport(sport: String?): List<Formation> =
    (sport?.let { SPORT_FORMATIONS[it] }) ?: FALLBACK

/** The first formation for a sport — used when a team has none selected yet. */
fun defaultFormation(sport: String?): Formation = formationsForSport(sport).first()

/**
 * Look up a specific formation for a sport. Returns null when the id is absent
 * or is not one of the sport's formations (an id belonging to another sport
 * does not resolve).
 */
fun getFormation(sport: String?, formationId: String?): Formation? {
    if (formationId.isNullOrEmpty()) return null
    return formationsForSport(sport).find { it.id == formationId }
}

/**
 * The formation to render for a stored team: the team's own when it resolves
 * for the event's sport, otherwise the sport default. Mirrors the web's
 * `getFormation(sport, team.formation) ?? getDefaultFormation(sport)`.
 */
fun resolveFormation(sport: String?, formationId: String?): Formation =
    getFormation(sport, formationId) ?: defaultFormation(sport)

/**
 * Base position (0 = top of the pitch, 1 = bottom) of a slot, by team half.
 * Team 0 owns the top half (own goal at the top), team 1 the bottom half.
 */
fun basePitchFraction(teamIndex: Int, slotX: Float): Float =
    if (teamIndex == 0) slotX * 0.5f else 0.5f + (1f - slotX) * 0.5f

/**
 * Team a dragged token lands on, given its base pitch position and the drag
 * delta. Crossing the halfway line (0.5) switches halves. Returns -1 when the
 * pitch has not been measured yet.
 */
fun targetTeamForDrag(basePitchFraction: Float, dragDeltaY: Float, pitchHeight: Int): Int {
    if (pitchHeight <= 0) return -1
    val current = basePitchFraction + dragDeltaY / pitchHeight
    return if (current < 0.5f) 0 else 1
}
