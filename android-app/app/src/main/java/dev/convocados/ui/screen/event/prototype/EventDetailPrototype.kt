package dev.convocados.ui.screen.event.prototype

/*
 * PROTOTYPE — THROWAWAY (delete after decision).
 *
 * Question: what should the revamped Android event page look like?
 * Three radically different variants on the existing event/{eventId} route,
 * switchable via a `?variant=` nav argument (debug builds only):
 *   A = HERO      full-bleed urgency-tinted hero header, huge countdown
 *   B = DOCK      compact info strip + persistent bottom action dock
 *   C = TIMELINE  lifecycle rail: Now → Before → Teams → After
 *
 * Winner gets folded into EventDetailScreen.kt; losers + this package die.
 */

import androidx.compose.foundation.background
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.convocados.data.api.EventDetail
import dev.convocados.data.api.GameHistory
import dev.convocados.data.api.EloUpdate
import dev.convocados.data.api.PaymentSnapshotEntry
import dev.convocados.data.api.Player
import dev.convocados.data.api.RosterPlayer
import dev.convocados.data.api.TeamMember
import dev.convocados.data.api.TeamResult
import dev.convocados.data.api.UserProfile
import dev.convocados.data.api.BalanceResponse
import dev.convocados.data.api.BalanceAggregate
import dev.convocados.data.api.PlayerBalance
import dev.convocados.data.api.PostGameStatus
import dev.convocados.data.api.PaidAggregate
import dev.convocados.data.api.KnownPlayer
import dev.convocados.data.api.CoPlaySuggestion
import dev.convocados.ui.screen.event.EventDetailViewModel
import dev.convocados.ui.screen.event.EventScreenState
import kotlinx.coroutines.delay
import java.time.Duration
import java.time.Instant

/** Navigation callbacks shared by all variants. */
internal data class ProtoNav(
    val onBack: () -> Unit,
    val onSettings: () -> Unit,
    val onRankings: () -> Unit,
    val onPayments: () -> Unit,
    val onLog: () -> Unit,
    val onAttendance: () -> Unit,
    val onNotificationPrefs: () -> Unit,
    val onUserClick: (String) -> Unit,
    val onHistoryClick: (String) -> Unit,
    val onAllHistory: () -> Unit,
    val onCourtAlternatives: () -> Unit,
)

// ── Phase / countdown model (parity with web countdownUrgency) ──────────────

internal enum class EventPhase { NORMAL, SOON, URGENT, LIVE, PAST }

internal data class PhaseUi(
    val phase: EventPhase,
    /** Primary time line: countdown / "Live now" / "Next game: …" / "Ended". */
    val timeLine: String,
    /** Secondary caption: absolute date (+ recurrence note). */
    val secondary: String?,
)

internal fun parseInstant(iso: String): Instant? =
    runCatching { Instant.parse(iso) }.getOrNull()

internal fun countdownText(remaining: Duration): String {
    val d = remaining.toDays()
    val h = remaining.toHours() % 24
    val m = remaining.toMinutes() % 60
    val s = remaining.seconds % 60
    return when {
        d > 0 -> "${d}d ${h}h ${m}m"
        h > 0 -> "%dh %02dm %02ds".format(h, m, s)
        else -> "%02dm %02ds".format(m, s)
    }
}

internal fun computePhaseUi(event: EventDetail, now: Instant): PhaseUi {
    val start = parseInstant(event.dateTime)
    if (start == null) return PhaseUi(EventPhase.NORMAL, event.dateTime, null)
    val end = start.plus(Duration.ofMinutes(event.durationMinutes.toLong()))
    val phase = when {
        now >= end -> EventPhase.PAST
        now >= start -> EventPhase.LIVE
        now >= start.minus(Duration.ofHours(2)) -> EventPhase.URGENT
        now >= start.minus(Duration.ofHours(24)) -> EventPhase.SOON
        else -> EventPhase.NORMAL
    }
    return when (phase) {
        EventPhase.NORMAL -> PhaseUi(
            phase,
            dev.convocados.ui.screen.games.formatEventDateInTz(event.dateTime, event.timezone),
            if (event.recurrenceRule != null) event.recurrenceRule else null,
        )
        EventPhase.SOON, EventPhase.URGENT -> PhaseUi(
            phase,
            countdownText(Duration.between(now, start)),
            dev.convocados.ui.screen.games.formatEventDateInTz(event.dateTime, event.timezone),
        )
        EventPhase.LIVE -> PhaseUi(phase, "Live now", null)
        EventPhase.PAST ->
            if (event.isRecurring && event.nextResetAt != null && parseInstant(event.nextResetAt!!)?.let { it > now } == true)
                PhaseUi(phase, "Next game: ${dev.convocados.ui.screen.games.formatEventDateInTz(event.nextResetAt!!, event.timezone)}", event.recurrenceRule)
            else PhaseUi(phase, "Ended", null)
    }
}

/** Ticking (1s) phase UI derived from the event date/duration. */
@Composable
internal fun rememberPhaseUi(event: EventDetail): PhaseUi {
    val initial = remember(event.dateTime, event.durationMinutes) {
        runCatching { computePhaseUi(event, Instant.now()) }.getOrElse { PhaseUi(EventPhase.NORMAL, event.dateTime, null) }
    }
    return produceState(initial, event) {
        while (true) {
            value = runCatching { computePhaseUi(event, Instant.now()) }.getOrDefault(value)
            delay(1000)
        }
    }.value
}

/** Accent color for a phase; bg is the same hue heavily faded toward surface. */
@Composable
internal fun phaseColors(phase: EventPhase): Pair<Color, Color> {
    val dark = isSystemInDarkTheme()
    val soonColor = if (dark) Color(0xFFFFC94D) else Color(0xFF9A6700)
    val base = MaterialTheme.colorScheme.surface
    val accent = when (phase) {
        EventPhase.NORMAL -> MaterialTheme.colorScheme.primary
        EventPhase.SOON -> soonColor
        EventPhase.URGENT -> MaterialTheme.colorScheme.error
        EventPhase.LIVE -> MaterialTheme.colorScheme.primary
        EventPhase.PAST -> MaterialTheme.colorScheme.outline
    }
    val bgAlpha = when (phase) {
        EventPhase.NORMAL -> 0.08f
        EventPhase.SOON, EventPhase.URGENT, EventPhase.LIVE -> 0.12f
        EventPhase.PAST -> 0.06f
    }
    // Fade accent toward surface instead of alpha-compositing so text stays legible.
    val bg = lerp(base, accent, bgAlpha)
    return accent to bg
}

// ── Derived roster helpers ───────────────────────────────────────────────────

internal fun activePlayersOf(e: EventDetail) = e.players.take(e.maxPlayers)
internal fun benchPlayersOf(e: EventDetail) = e.players.drop(e.maxPlayers)

internal fun spotsLabelOf(e: EventDetail): String {
    val left = e.maxPlayers - e.players.size
    return when {
        left <= 0 -> "Full"
        left == 1 -> "1 spot left"
        else -> "$left spots left"
    }
}

// ── Variant switcher ────────────────────────────────────────────────────────

internal enum class VariantKey(val label: String) {
    HERO("Hero"),
    DOCK("Action dock"),
    TIMELINE("Timeline");
}

/**
 * PROTOTYPE switcher host. Owns ViewModel + snackbar plumbing shared by all
 * variants and renders the floating A/B/C bar. Initial variant comes from the
 * `?variant=` nav argument; arrows cycle locally afterwards.
 */
@Composable
internal fun EventDetailPrototypeScreen(
    eventId: String,
    initialVariant: String,
    nav: ProtoNav,
    viewModel: EventDetailViewModel = hiltViewModel(),
) {
    LaunchedEffect(eventId) { viewModel.load(eventId) }

    var current by rememberSaveable {
        mutableStateOf(
            VariantKey.entries.firstOrNull { it.name.equals(initialVariant, ignoreCase = true) } ?: VariantKey.HERO
        )
    }

    val state by viewModel.state.collectAsStateWithLifecycle()
    val user by viewModel.user.collectAsStateWithLifecycle()
    var pendingAdd by remember { mutableStateOf<dev.convocados.ui.screen.event.PendingAdd?>(null) }

    // Demo fallback: when unauthenticated or no data yet, render rich fake data so
    // screenshots work without login. Each variant gets a different phase to
    // showcase phase colors (HERO=SOON, DOCK=URGENT, TIMELINE=PAST-recurring).
    val demoEnabled = state.event == null && !state.loading
    val demo = remember(current, demoEnabled) {
        if (demoEnabled) buildDemoState(current) else null
    }
    val displayState = demo?.first ?: state
    val displayUser = demo?.second ?: user
    // Synthetic postGame/history/balance are embedded in displayState already.

    val snackbarHostState = androidx.compose.runtime.remember { androidx.compose.material3.SnackbarHostState() }
    val context = androidx.compose.ui.platform.LocalContext.current

    LaunchedEffect(state.teamMoveUndo) {
        val undo = state.teamMoveUndo ?: return@LaunchedEffect
        val result = snackbarHostState.showSnackbar(
            message = context.getString(dev.convocados.R.string.player_moved, undo.playerName),
            actionLabel = context.getString(dev.convocados.R.string.undo),
            duration = androidx.compose.material3.SnackbarDuration.Short,
        )
        if (result == androidx.compose.material3.SnackbarResult.ActionPerformed) viewModel.undoTeamMove(eventId)
    }

    Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        Box(Modifier.fillMaxSize()) {
            when (current) {
                VariantKey.HERO -> VariantHero(eventId, displayState, displayUser, viewModel, nav, snackbarHostState,
                    onRequestPendingAdd = { pendingAdd = it })
                VariantKey.DOCK -> VariantDock(eventId, displayState, displayUser, viewModel, nav, snackbarHostState,
                    onRequestPendingAdd = { pendingAdd = it })
                VariantKey.TIMELINE -> VariantTimeline(eventId, displayState, displayUser, viewModel, nav, snackbarHostState,
                    onRequestPendingAdd = { pendingAdd = it })
            }
            PrototypeOverlays(eventId, displayState, displayUser, viewModel, pendingAdd, onDismissPendingAdd = { pendingAdd = null })
        }
        Box(Modifier.align(Alignment.BottomCenter).fillMaxWidth().navigationBarsPadding().padding(bottom = if (current == VariantKey.DOCK) 104.dp else 20.dp),
            contentAlignment = Alignment.BottomCenter) {
            PrototypeSwitcherBar(current, onChange = { current = it })
        }
    }
}

/** Demo data for unauthenticated screenshot testing. One variant → one phase. */
internal fun buildDemoState(variant: VariantKey): Pair<EventScreenState, UserProfile> {
    val now = Instant.now()
    val demoEvent = when (variant) {
        VariantKey.HERO -> demoEvent(now.plus(Duration.ofHours(5)), isRecurring = false, nextResetAt = null, recurrenceRule = "Weekly · Thu 19:00")
        VariantKey.DOCK -> demoEvent(now.plus(Duration.ofMinutes(90)), isRecurring = false, nextResetAt = null, recurrenceRule = null)
        VariantKey.TIMELINE -> demoEvent(now.minus(Duration.ofHours(3)), isRecurring = true, nextResetAt = now.plus(Duration.ofDays(6)), recurrenceRule = "Weekly · Thu 19:00")
    }
    val demoUser = UserProfile(id = "u_demo", name = "João", email = "joao@example.com", image = null)
    val history = listOf(
        GameHistory(id = "h1", dateTime = now.minus(Duration.ofDays(7)).toString(), scoreOne = 5, scoreTwo = 3, teamOneName = "Whites", teamTwoName = "Blues", eloUpdates = listOf(EloUpdate("Marta", +12), EloUpdate("João", -8))),
        GameHistory(id = "h2", dateTime = now.minus(Duration.ofDays(14)).toString(), scoreOne = 2, scoreTwo = 2, teamOneName = "Whites", teamTwoName = "Blues"),
    )
    val payments = listOf(
        PaymentSnapshotEntry("Marta", 5.0, "paid"),
        PaymentSnapshotEntry("João", 5.0, "pending"),
        PaymentSnapshotEntry("Alex", 5.0, "paid"),
    )
    val postGame = PostGameStatus(
        gameEnded = variant == VariantKey.TIMELINE,
        hasScore = false,
        hasCost = true,
        allPaid = false,
        allComplete = false,
        isParticipant = true,
        isPlayer = true,
        latestHistoryId = "h1",
        costAmount = 15.0,
        hasPendingPastPayments = variant == VariantKey.TIMELINE,
        paymentsSnapshot = payments,
        mvpEnabled = true,
        mvpComplete = false,
        paidAggregate = PaidAggregate(paidCount = 2, totalCount = 3),
    )
    val balance = BalanceResponse(
        enforcement = "nudge",
        callerBalance = PlayerBalance(playerName = "João", amount = 5.0, gamesOwed = 1, streak = 3),
        aggregate = BalanceAggregate(paidCount = 6, totalCount = 9),
    )
    val state = EventScreenState(
        loading = false,
        event = demoEvent,
        history = history,
        knownPlayers = listOf(KnownPlayer("Rui", 12), KnownPlayer("Sofia", 8), KnownPlayer("Tiago", 5)),
        postGame = postGame,
        postGamePayments = payments,
        isFollowing = true,
        isPlayer = false,
        isAdmin = true,
        balance = balance,
        coPlaySuggestions = listOf(CoPlaySuggestion("u2", "Marta", gamesPlayed = 9, coPlayCount = 7, score = 0.9), CoPlaySuggestion("u3", "Alex", gamesPlayed = 6, coPlayCount = 4, score = 0.7)),
    )
    return state to demoUser
}

private fun demoEvent(at: Instant, isRecurring: Boolean, nextResetAt: Instant?, recurrenceRule: String?): EventDetail {
    val players = listOf(
        Player("p1", "Marta", 0, "u2"),
        Player("p2", "João", 1, "u_demo"),
        Player("p3", "Alex", 2, "u3"),
        Player("p4", "Sofia", 3),
        Player("p5", "Rui", 4),
        Player("p6", "Tiago", 5),
        Player("p7", "Inês", 6),
        Player("p8", "Nuno", 7), // bench start
        Player("p9", "Carla", 8),
    )
    return EventDetail(
        id = "demo",
        title = "Thursday 5-a-side",
        location = "Riverside Astro, Pitch 2",
        latitude = 38.7223, longitude = -9.1393,
        dateTime = at.toString(),
        timezone = "Europe/Lisbon",
        maxPlayers = 10,
        teamOneName = "Whites",
        teamTwoName = "Blues",
        sport = "football",
        durationMinutes = 90,
        isPublic = false,
        isRecurring = isRecurring,
        recurrenceRule = recurrenceRule,
        nextResetAt = nextResetAt?.toString(),
        ownerId = "u_demo",
        ownerName = "João",
        isAdmin = true,
        eloEnabled = true,
        splitCostsEnabled = true,
        mvpEnabled = true,
        players = players,
        teamResults = listOf(
            TeamResult("t1", "Whites", listOf(TeamMember("p1", "Marta", 0), TeamMember("p3", "Alex", 1), TeamMember("p5", "Rui", 2))),
            TeamResult("t2", "Blues", listOf(TeamMember("p2", "João", 0), TeamMember("p4", "Sofia", 1), TeamMember("p6", "Tiago", 2))),
        ),
        invited = listOf(RosterPlayer("i1", "Hugo"), RosterPlayer("i2", "Beatriz")),
        declined = listOf(RosterPlayer("d1", "Marco")),
    )
}

/** Floating variant-cycling pill, visually distinct from the page. */
@Composable
private fun PrototypeSwitcherBar(current: VariantKey, onChange: (VariantKey) -> Unit) {
    Surface(
        shape = RoundedCornerShape(50),
        color = Color(0xEE202124),
        contentColor = Color.White,
        shadowElevation = 8.dp,
        border = androidx.compose.foundation.BorderStroke(1.dp, Color.White.copy(alpha = 0.25f)),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(horizontal = 4.dp)) {
            IconButton(onClick = {
                val i = VariantKey.entries.indexOf(current)
                onChange(VariantKey.entries[(i - 1 + VariantKey.entries.size) % VariantKey.entries.size])
            }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Previous variant", tint = Color.White) }
            Text(
                "${current.name} · ${current.label}",
                fontWeight = FontWeight.SemiBold,
                style = MaterialTheme.typography.labelLarge,
                modifier = Modifier.padding(horizontal = 4.dp),
            )
            IconButton(onClick = {
                val i = VariantKey.entries.indexOf(current)
                onChange(VariantKey.entries[(i + 1) % VariantKey.entries.size])
            }) { Icon(Icons.AutoMirrored.Filled.ArrowForward, "Next variant", tint = Color.White) }
        }
    }
}
