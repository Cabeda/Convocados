package dev.convocados.wear.data.api

/** The point values used inside an individual tennis or padel game. */
enum class TennisPoint(val serializedValue: Int, val label: String) {
    LOVE(0, "0"),
    FIFTEEN(1, "15"),
    THIRTY(2, "30"),
    FORTY(3, "40"),
    ADVANTAGE(4, "AD"),
    ;

    companion object {
        fun fromSerializedValue(value: Int?): TennisPoint = entries.firstOrNull { it.serializedValue == value } ?: LOVE
    }
}

enum class TennisTeam(val serializedValue: Int) {
    ONE(1),
    TWO(2),
}

data class TennisGameScore(
    val teamOne: TennisPoint = TennisPoint.LOVE,
    val teamTwo: TennisPoint = TennisPoint.LOVE,
)

data class TennisPointResult(
    val score: TennisGameScore,
    val completedTeam: TennisTeam? = null,
)

/** Advance one point, including deuce, advantage, and game completion rules. */
fun advanceTennisPoint(score: TennisGameScore, winningTeam: TennisTeam): TennisPointResult = when (winningTeam) {
    TennisTeam.ONE -> when {
        score.teamOne == TennisPoint.ADVANTAGE -> TennisPointResult(TennisGameScore(), TennisTeam.ONE)
        score.teamTwo == TennisPoint.ADVANTAGE -> TennisPointResult(
            TennisGameScore(TennisPoint.FORTY, TennisPoint.FORTY),
        )
        score.teamOne == TennisPoint.FORTY && score.teamTwo == TennisPoint.FORTY -> TennisPointResult(
            TennisGameScore(TennisPoint.ADVANTAGE, TennisPoint.FORTY),
        )
        score.teamOne == TennisPoint.FORTY -> TennisPointResult(TennisGameScore(), TennisTeam.ONE)
        score.teamTwo == TennisPoint.FORTY -> TennisPointResult(
            TennisGameScore(nextPoint(score.teamOne), TennisPoint.FORTY),
        )
        else -> TennisPointResult(score.copy(teamOne = nextPoint(score.teamOne)))
    }
    TennisTeam.TWO -> when {
        score.teamTwo == TennisPoint.ADVANTAGE -> TennisPointResult(TennisGameScore(), TennisTeam.TWO)
        score.teamOne == TennisPoint.ADVANTAGE -> TennisPointResult(
            TennisGameScore(TennisPoint.FORTY, TennisPoint.FORTY),
        )
        score.teamOne == TennisPoint.FORTY && score.teamTwo == TennisPoint.FORTY -> TennisPointResult(
            TennisGameScore(TennisPoint.FORTY, TennisPoint.ADVANTAGE),
        )
        score.teamTwo == TennisPoint.FORTY -> TennisPointResult(TennisGameScore(), TennisTeam.TWO)
        score.teamOne == TennisPoint.FORTY -> TennisPointResult(
            TennisGameScore(TennisPoint.FORTY, nextPoint(score.teamTwo)),
        )
        else -> TennisPointResult(score.copy(teamTwo = nextPoint(score.teamTwo)))
    }
}

/** Best-effort inverse used by the existing long-press decrement affordance. */
fun rewindTennisPoint(score: TennisGameScore, team: TennisTeam): TennisGameScore = when (team) {
    TennisTeam.ONE -> when {
        score.teamTwo == TennisPoint.ADVANTAGE -> score
        score.teamOne == TennisPoint.ADVANTAGE -> TennisGameScore(TennisPoint.FORTY, TennisPoint.FORTY)
        score.teamOne == TennisPoint.FORTY && score.teamTwo == TennisPoint.FORTY -> TennisGameScore(TennisPoint.THIRTY, TennisPoint.FORTY)
        else -> score.copy(teamOne = previousPoint(score.teamOne))
    }
    TennisTeam.TWO -> when {
        score.teamOne == TennisPoint.ADVANTAGE -> score
        score.teamTwo == TennisPoint.ADVANTAGE -> TennisGameScore(TennisPoint.FORTY, TennisPoint.FORTY)
        score.teamOne == TennisPoint.FORTY && score.teamTwo == TennisPoint.FORTY -> TennisGameScore(TennisPoint.FORTY, TennisPoint.THIRTY)
        else -> score.copy(teamTwo = previousPoint(score.teamTwo))
    }
}

/** Undo a point after a completed game, retaining a visible 40-40 correction state. */
fun rewindTennisSetPoint(set: SetScore, team: TennisTeam): SetScore {
    val gameScore = set.tennisGameScore()
    if (set.pointTeamOne == null && set.pointTeamTwo == null) {
        if (set.teamOne == 0 && set.teamTwo == 0) return set
        return when (team) {
            TennisTeam.ONE -> set.copy(teamOne = (set.teamOne - 1).coerceAtLeast(0))
            TennisTeam.TWO -> set.copy(teamTwo = (set.teamTwo - 1).coerceAtLeast(0))
        }
    }
    val completedGameWasJustReset =
        set.pointTeamOne != null && set.pointTeamTwo != null && !set.pointGameActive && gameScore == TennisGameScore()
    if (!completedGameWasJustReset) {
        val otherTeamHasAdvantage = when (team) {
            TennisTeam.ONE -> gameScore.teamTwo == TennisPoint.ADVANTAGE
            TennisTeam.TWO -> gameScore.teamOne == TennisPoint.ADVANTAGE
        }
        if (otherTeamHasAdvantage) return set

        val rewound = rewindTennisPoint(gameScore, team)
        return if (rewound == TennisGameScore()) {
            set.copy(
                pointTeamOne = TennisPoint.LOVE.serializedValue,
                pointTeamTwo = TennisPoint.LOVE.serializedValue,
                pointGameActive = true,
                pointGameCompletedBy = null,
            )
        } else {
            set.withTennisGameScore(rewound)
        }
    }

    val completedBy = set.pointGameCompletedBy?.let { winner ->
        TennisTeam.entries.firstOrNull { it.serializedValue == winner }
    } ?: when {
        set.teamOne > set.teamTwo -> TennisTeam.ONE
        set.teamTwo > set.teamOne -> TennisTeam.TWO
        else -> null
    }
    if (completedBy != team) return set

    return when (team) {
        TennisTeam.ONE -> set.copy(
            teamOne = (set.teamOne - 1).coerceAtLeast(0),
            pointTeamOne = TennisPoint.FORTY.serializedValue,
            pointTeamTwo = TennisPoint.FORTY.serializedValue,
            pointGameActive = true,
            pointGameCompletedBy = null,
        )
        TennisTeam.TWO -> set.copy(
            teamTwo = (set.teamTwo - 1).coerceAtLeast(0),
            pointTeamOne = TennisPoint.FORTY.serializedValue,
            pointTeamTwo = TennisPoint.FORTY.serializedValue,
            pointGameActive = true,
            pointGameCompletedBy = null,
        )
    }
}

fun displayTennisPoint(score: TennisGameScore): String = when {
    score.teamOne == TennisPoint.FORTY && score.teamTwo == TennisPoint.FORTY -> "Deuce"
    else -> "${score.teamOne.label}–${score.teamTwo.label}"
}

fun displayTennisPointForTeam(score: TennisGameScore, team: TennisTeam): String = when (team) {
    TennisTeam.ONE -> score.teamOne.label
    TennisTeam.TWO -> score.teamTwo.label
}

fun SetScore.tennisGameScore(): TennisGameScore = TennisGameScore(
    teamOne = TennisPoint.fromSerializedValue(pointTeamOne),
    teamTwo = TennisPoint.fromSerializedValue(pointTeamTwo),
)

fun SetScore.withTennisGameScore(score: TennisGameScore): SetScore = copy(
    pointTeamOne = score.teamOne.serializedValue,
    pointTeamTwo = score.teamTwo.serializedValue,
    pointGameActive = true,
    pointGameCompletedBy = null,
)

private fun nextPoint(point: TennisPoint): TennisPoint = when (point) {
    TennisPoint.LOVE -> TennisPoint.FIFTEEN
    TennisPoint.FIFTEEN -> TennisPoint.THIRTY
    TennisPoint.THIRTY -> TennisPoint.FORTY
    TennisPoint.FORTY, TennisPoint.ADVANTAGE -> TennisPoint.ADVANTAGE
}

private fun previousPoint(point: TennisPoint): TennisPoint = when (point) {
    TennisPoint.LOVE -> TennisPoint.LOVE
    TennisPoint.FIFTEEN -> TennisPoint.LOVE
    TennisPoint.THIRTY -> TennisPoint.FIFTEEN
    TennisPoint.FORTY -> TennisPoint.THIRTY
    TennisPoint.ADVANTAGE -> TennisPoint.FORTY
}
