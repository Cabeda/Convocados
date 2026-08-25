package dev.convocados.ui.screen.event.prototype

/*
 * PROTOTYPE — THROWAWAY. Variant A "Hero":
 * full-bleed phase-tinted hero header with a huge ticking countdown, content
 * flowing below as cards. Primary identity of the page = WHEN + HOW FULL.
 */

import android.content.Intent
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.material3.SnackbarHostState
import dev.convocados.R
import dev.convocados.data.api.EventDetail
import dev.convocados.data.api.UserProfile
import dev.convocados.ui.screen.event.EventDetailViewModel
import dev.convocados.ui.screen.event.EventScreenState
import dev.convocados.ui.screen.event.PlayerAvatar
import dev.convocados.ui.screen.event.PlayerRow
import dev.convocados.ui.screen.games.formatEventDateInTz
import dev.convocados.ui.screen.games.sportEmoji

@Composable
internal fun VariantHero(
    eventId: String,
    state: EventScreenState,
    user: UserProfile?,
    viewModel: EventDetailViewModel,
    nav: ProtoNav,
    snackbarHostState: SnackbarHostState,
    onRequestPendingAdd: (dev.convocados.ui.screen.event.PendingAdd) -> Unit,
) {
    val event = state.event
    val context = LocalContext.current
    var editingScoreId by remember { mutableStateOf<String?>(null) }
    var scoreOne by remember { mutableStateOf("") }
    var scoreTwo by remember { mutableStateOf("") }
    var declinedOpen by remember { mutableStateOf(false) }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        snackbarHost = { SnackbarHost(snackbarHostState) },
    ) { padding ->
        if (event == null) {
            Box(Modifier.fillMaxSize().padding(padding), Alignment.Center) {
                CircularProgressIndicator(color = MaterialTheme.colorScheme.primary)
            }
            return@Scaffold
        }

        val phaseUi = rememberPhaseUi(event)
        val (accent, bg) = phaseColors(phaseUi.phase)
        val active = activePlayersOf(event)
        val bench = benchPlayersOf(event)
        val isOwner = user?.id == event.ownerId && event.ownerId != null
        val myPlayer = user?.let { u -> event.players.find { it.name.equals(u.name, true) } }
        val isOnBench = myPlayer != null && event.players.indexOf(myPlayer) >= event.maxPlayers
        val fillFraction = if (event.maxPlayers > 0) active.size.toFloat() / event.maxPlayers else 0f

        Column(
            Modifier
                .fillMaxSize()
                .background(MaterialTheme.colorScheme.background)
                .verticalScroll(rememberScrollState())
                .padding(padding),
        ) {
            // ══ HERO ══════════════════════════════════════════════════════
            Box(
                Modifier
                    .fillMaxWidth()
                    .background(
                        Brush.verticalGradient(listOf(bg, MaterialTheme.colorScheme.background)),
                    )
                    .padding(horizontal = 16.dp)
                    .padding(top = 8.dp, bottom = 20.dp),
            ) {
                // Top icon row overlays the hero content
                Column {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        IconButton(onClick = nav.onBack) {
                            Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back))
                        }
                        Spacer(Modifier.weight(1f))
                        if (!state.isPlayer) {
                            IconButton(onClick = { viewModel.toggleFollow(eventId) }) {
                                Icon(
                                    if (state.isFollowing) Icons.Default.Bookmark else Icons.Default.BookmarkBorder,
                                    contentDescription = if (state.isFollowing) stringResource(R.string.following) else stringResource(R.string.follow),
                                    tint = if (state.isFollowing) accent else MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                        if (state.isFollowing) {
                            IconButton(onClick = { viewModel.showNotifications() }) {
                                Icon(Icons.Default.Notifications, stringResource(R.string.notification_settings), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                        HeroMoreMenu(event, state, viewModel, eventId, nav)
                    }

                    Text(sportEmoji(event.sport), fontSize = 40.sp)
                    Text(
                        event.title,
                        style = MaterialTheme.typography.headlineMedium,
                        fontWeight = FontWeight.ExtraBold,
                        modifier = Modifier.padding(top = 4.dp).semantics { heading() },
                    )
                    event.ownerName?.let {
                        Text("Managed by $it", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }

                    // Huge countdown / time line
                    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 12.dp)) {
                        if (phaseUi.phase == EventPhase.LIVE) PulsingDot(accent) else
                            Icon(Icons.Default.Schedule, null, tint = accent, modifier = Modifier.size(28.dp))
                        Spacer(Modifier.width(10.dp))
                        Column {
                            Text(
                                phaseUi.timeLine,
                                style = MaterialTheme.typography.headlineSmall,
                                fontWeight = FontWeight.Bold,
                                color = accent,
                            )
                            phaseUi.secondary?.let {
                                Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }

                    // Location chip → Google Maps
                    if (event.location.isNotBlank()) {
                        Surface(
                            shape = RoundedCornerShape(50),
                            color = MaterialTheme.colorScheme.surface.copy(alpha = 0.85f),
                            modifier = Modifier.padding(top = 12.dp).clickable {
                                runCatching {
                                    context.startActivity(Intent(Intent.ACTION_VIEW, android.net.Uri.parse("geo:0,0?q=${android.net.Uri.encode(event.location)}")))
                                }
                            },
                        ) {
                            Row(Modifier.padding(horizontal = 12.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                                Icon(Icons.Default.Place, null, tint = accent, modifier = Modifier.size(16.dp))
                                Spacer(Modifier.width(6.dp))
                                Text(event.location, style = MaterialTheme.typography.bodyMedium)
                            }
                        }
                    }

                    // Fill meter
                    Column(Modifier.padding(top = 14.dp)) {
                        LinearProgressIndicator(
                            progress = { fillFraction },
                            modifier = Modifier.fillMaxWidth().height(6.dp).clip(RoundedCornerShape(3.dp)),
                            color = when {
                                fillFraction >= 1f -> MaterialTheme.colorScheme.error
                                fillFraction >= 0.75f -> Color(0xFFB26A00)
                                else -> MaterialTheme.colorScheme.primary
                            },
                            trackColor = MaterialTheme.colorScheme.surfaceVariant,
                        )
                        Text(
                            "${spotsLabelOf(event)} · ${active.size}/${event.maxPlayers} playing",
                            style = MaterialTheme.typography.labelMedium,
                            fontWeight = FontWeight.SemiBold,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(top = 6.dp),
                        )
                    }
                }
            }

            // ══ BODY CARDS ════════════════════════════════════════════════
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {

                state.undoData?.let { undo ->
                    Card(
                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
                        modifier = Modifier.fillMaxWidth().clickable { viewModel.undoRemove(eventId) },
                    ) {
                        Text(
                            stringResource(R.string.removed_tap_undo, undo.name),
                            color = MaterialTheme.colorScheme.primary,
                            fontWeight = FontWeight.SemiBold,
                            textAlign = TextAlign.Center,
                            modifier = Modifier.padding(12.dp).fillMaxWidth(),
                        )
                    }
                }

                // Post-game wrap-up
                HeroWrapUp(eventId, state, viewModel, editingScoreId, scoreOne, scoreTwo,
                    onEditScore = { id, s1, s2 -> editingScoreId = id; scoreOne = s1; scoreTwo = s2 },
                    onScoreChange = { a, b -> scoreOne = a; scoreTwo = b },
                    onSaveScore = { editingScoreId = null },
                    onVoteMvp = { nav.onHistoryClick(it) })

                // RSVP — Your response
                if (user?.name != null) {
                    Card(Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            Text("YOUR RESPONSE", style = MaterialTheme.typography.labelSmall, letterSpacing = 1.5.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                Button(
                                    onClick = { viewModel.addPlayer(eventId, user!!.name, true) },
                                    enabled = myPlayer == null,
                                    colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primary),
                                    modifier = Modifier.weight(1f),
                                ) {
                                    Icon(Icons.Default.HowToReg, null, Modifier.size(18.dp)); Spacer(Modifier.width(6.dp))
                                    Text(if (myPlayer == null) "Going" else "Going ✓")
                                }
                                OutlinedButton(
                                    onClick = { myPlayer?.let { viewModel.removePlayer(eventId, it.id) } },
                                    enabled = myPlayer != null,
                                    colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error),
                                    modifier = Modifier.weight(1f),
                                ) {
                                    Icon(Icons.Default.PersonOff, null, Modifier.size(18.dp)); Spacer(Modifier.width(6.dp))
                                    Text("Not coming")
                                }
                            }
                        }
                    }

                    // Join status / pay CTA
                    val callerBalance = state.balance?.callerBalance
                    val hasDebt = callerBalance != null && callerBalance.amount > 0
                    val enforcement = state.balance?.enforcement ?: "off"
                    if (myPlayer == null) {
                        Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer)) {
                            Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                if (hasDebt && enforcement != "off") {
                                    Text(stringResource(R.string.owe_amount, "%.2f".format(callerBalance!!.amount), callerBalance.gamesOwed), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.SemiBold)
                                }
                                Button(
                                    onClick = {
                                        if (hasDebt && enforcement != "off") viewModel.showPaymentNudge()
                                        else viewModel.addPlayer(eventId, user!!.name, true)
                                    },
                                    enabled = !state.paymentGateBlocked,
                                    modifier = Modifier.fillMaxWidth(),
                                    colors = ButtonDefaults.buttonColors(
                                        containerColor = if (hasDebt && enforcement != "off") MaterialTheme.colorScheme.tertiary else MaterialTheme.colorScheme.primary,
                                    ),
                                ) {
                                    Text(
                                        if (hasDebt && enforcement != "off") stringResource(R.string.pay_and_join, "%.2f".format(callerBalance!!.amount))
                                        else stringResource(R.string.join_as, user!!.name),
                                        fontWeight = FontWeight.Bold,
                                    )
                                }
                            }
                        }
                    } else {
                        Card {
                            Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                                Text(
                                    if (isOnBench) stringResource(R.string.on_bench) else stringResource(R.string.joined_as, myPlayer.name),
                                    color = if (isOnBench) MaterialTheme.colorScheme.tertiary else MaterialTheme.colorScheme.primary,
                                    fontWeight = FontWeight.SemiBold,
                                    modifier = Modifier.weight(1f),
                                )
                                OutlinedButton(onClick = { viewModel.removePlayer(eventId, myPlayer.id) }, colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error)) {
                                    Text(stringResource(R.string.leave))
                                }
                            }
                        }
                    }
                }

                // Payment row (split costs on)
                if (event.splitCostsEnabled || (state.balance?.callerBalance?.amount ?: 0.0) > 0) {
                    Card(Modifier.fillMaxWidth().clickable(onClick = nav.onPayments)) {
                        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Default.Payments, null, tint = MaterialTheme.colorScheme.primary)
                            Spacer(Modifier.width(10.dp))
                            Column(Modifier.weight(1f)) {
                                Text("Payments", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                                val owed = state.balance?.callerBalance?.amount ?: 0.0
                                if (owed > 0) Text("You owe %.2f".format(owed), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.SemiBold)
                                else Text("All settled", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                            Icon(Icons.Default.ChevronRight, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }

                // Teams
                val teams = event.teamResults
                if (teams != null && teams.size == 2) {
                    Card(Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text("Teams", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, modifier = Modifier.semantics { heading() })
                            Text("Tap a player to move them", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Row {
                                HeroTeamColumn(teams[0], event, toTeamOne = false, viewModel, eventId, Modifier.weight(1f), MaterialTheme.colorScheme.primary)
                                Text(stringResource(R.string.vs), color = MaterialTheme.colorScheme.outline, fontWeight = FontWeight.Bold, modifier = Modifier.align(Alignment.CenterVertically).padding(horizontal = 8.dp))
                                HeroTeamColumn(teams[1], event, toTeamOne = true, viewModel, eventId, Modifier.weight(1f), MaterialTheme.colorScheme.secondary)
                            }
                        }
                    }
                } else if (active.size >= 2) {
                    Card(Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text(stringResource(R.string.create_teams_title), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                            Text(stringResource(R.string.create_teams_desc), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Button(onClick = { viewModel.randomize(eventId, true) }, modifier = Modifier.weight(1f)) {
                                    Icon(Icons.Default.Balance, null, Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text(stringResource(R.string.teams_balanced))
                                }
                                OutlinedButton(onClick = { viewModel.randomize(eventId, false) }, modifier = Modifier.weight(1f)) {
                                    Icon(Icons.Default.Shuffle, null, Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text(stringResource(R.string.teams_random))
                                }
                            }
                        }
                    }
                }

                // Roster card
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text("Players", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f).semantics { heading() })
                            AssistChip(onClick = { viewModel.randomize(eventId, event.balanced) }, label = { Text(stringResource(R.string.randomize)) }, leadingIcon = { Icon(Icons.Default.Shuffle, null, Modifier.size(16.dp)) })
                        }
                        PlayerGroup(active, user, isOwner, false, viewModel, eventId, nav)
                        if (bench.isNotEmpty()) {
                            HorizontalDivider()
                            Text(stringResource(R.string.bench_count, bench.size), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.tertiary, fontWeight = FontWeight.Bold)
                            PlayerGroup(bench, user, isOwner, true, viewModel, eventId, nav)
                        }
                        if (event.invited.isNotEmpty()) {
                            HorizontalDivider()
                            Text(stringResource(R.string.invited_count, event.invited.size), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Bold)
                            event.invited.forEach { Text("· ${it.name}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                        }
                        if (event.declined.isNotEmpty()) {
                            TextButton(onClick = { declinedOpen = !declinedOpen }) {
                                Text(if (declinedOpen) "Hide declined" else stringResource(R.string.declined_count, event.declined.size), style = MaterialTheme.typography.labelMedium)
                            }
                            if (declinedOpen) event.declined.forEach { Text("· ${it.name}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline) }
                        }
                        HorizontalDivider()
                        AddPlayerSection(eventId, state, viewModel, onRequestPendingAdd)
                    }
                }

                // History preview
                if (state.history.isNotEmpty()) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                        Text("History", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, modifier = Modifier.semantics { heading() })
                        TextButton(onClick = nav.onLog) { Text(stringResource(R.string.view_log), style = MaterialTheme.typography.bodySmall) }
                    }
                    state.history.take(2).forEach { h ->
                        Card(Modifier.fillMaxWidth().clickable { nav.onHistoryClick(h.id) }) {
                            Column(Modifier.padding(12.dp)) {
                                Text(formatEventDateInTz(h.dateTime, event.timezone), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
                                if (h.scoreOne != null && h.scoreTwo != null)
                                    Text("${h.teamOneName} ${h.scoreOne} – ${h.scoreTwo} ${h.teamTwoName}", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                                h.eloUpdates?.takeIf { it.isNotEmpty() }?.let { ups ->
                                    Row(Modifier.padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                        ups.forEach { eu ->
                                            Text("${eu.name} ${if (eu.delta > 0) "+" else ""}${eu.delta}", style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.SemiBold, color = if (eu.delta > 0) MaterialTheme.colorScheme.primary else if (eu.delta < 0) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.outline)
                                        }
                                    }
                                }
                            }
                        }
                    }
                    if (state.history.size > 2)
                        TextButton(onClick = nav.onAllHistory, modifier = Modifier.fillMaxWidth()) {
                            Text("See all games", color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.SemiBold)
                        }
                }
                Spacer(Modifier.height(72.dp))
            }
        }
    }
}

/** Post-game wrap-up card (score → payments → MVP), Hero styling. */
@Composable
private fun HeroWrapUp(
    eventId: String,
    state: EventScreenState,
    viewModel: EventDetailViewModel,
    editingScoreId: String?,
    scoreOne: String,
    scoreTwo: String,
    onEditScore: (id: String, s1: String, s2: String) -> Unit,
    onScoreChange: (String, String) -> Unit,
    onSaveScore: () -> Unit,
    onVoteMvp: (historyId: String) -> Unit,
) {
    val pg = state.postGame ?: return
    val show = pg.isParticipant && !pg.allComplete &&
        (pg.gameEnded || pg.hasPendingPastPayments || (pg.mvpEnabled && !pg.mvpComplete))
    if (!show) return

    val scoreDone = pg.hasScore
    val paysDone = pg.allPaid || !pg.hasCost
    val mvpDone = !pg.mvpEnabled || pg.mvpComplete
    val done = (if (scoreDone) 1 else 0) + (if (paysDone) 1 else 0) + (if (mvpDone) 1 else 0)
    val total = 2 + (if (pg.mvpEnabled) 1 else 0)

    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer),
        shape = RoundedCornerShape(16.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(Icons.Default.Celebration, null, tint = MaterialTheme.colorScheme.onSecondaryContainer)
                Text("Game over! Wrap it up", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.ExtraBold, color = MaterialTheme.colorScheme.onSecondaryContainer)
            }
            LinearProgressIndicator(
                progress = { done.toFloat() / total },
                modifier = Modifier.fillMaxWidth().height(4.dp).clip(RoundedCornerShape(2.dp)),
                color = MaterialTheme.colorScheme.primary,
                trackColor = MaterialTheme.colorScheme.surface,
            )

            // Task 1 — score
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(if (scoreDone) Icons.Default.CheckCircle else Icons.Default.RadioButtonUnchecked, null, Modifier.size(20.dp))
                Text(
                    if (scoreDone) stringResource(R.string.post_game_score_done) else stringResource(R.string.record_final_score),
                    style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f),
                )
            }
            if (!scoreDone && pg.latestHistoryId != null) {
                if (editingScoreId == pg.latestHistoryId) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                        OutlinedTextField(value = scoreOne, onValueChange = { onScoreChange(it.filter { c -> c.isDigit() }, scoreTwo) }, modifier = Modifier.width(64.dp), singleLine = true, placeholder = { Text("0") })
                        Text("–", style = MaterialTheme.typography.titleLarge)
                        OutlinedTextField(value = scoreTwo, onValueChange = { onScoreChange(scoreOne, it.filter { c -> c.isDigit() }) }, modifier = Modifier.width(64.dp), singleLine = true, placeholder = { Text("0") })
                        Button(onClick = {
                            val s1 = scoreOne.toIntOrNull() ?: return@Button
                            val s2 = scoreTwo.toIntOrNull() ?: return@Button
                            viewModel.saveScore(eventId, pg.latestHistoryId, s1, s2); onSaveScore()
                        }) { Text(stringResource(R.string.save), fontWeight = FontWeight.Bold) }
                    }
                } else {
                    Button(onClick = { onEditScore(pg.latestHistoryId, "", "") }, modifier = Modifier.fillMaxWidth()) {
                        Text(stringResource(R.string.record_score))
                    }
                }
            }

            // Task 2 — payments
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(if (paysDone) Icons.Default.CheckCircle else Icons.Default.RadioButtonUnchecked, null, Modifier.size(20.dp))
                val label = when {
                    !pg.hasCost -> stringResource(R.string.post_game_no_cost)
                    paysDone -> stringResource(R.string.post_game_payments_done)
                    state.postGamePayments != null -> stringResource(R.string.post_game_payments_summary, state.postGamePayments.count { it.status == "paid" }, state.postGamePayments.size)
                    else -> stringResource(R.string.post_game_payments_label)
                }
                Text(label, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
            }
            if (pg.hasCost && !paysDone && !state.postGamePayments.isNullOrEmpty()) {
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    state.postGamePayments.forEach { p ->
                        FilterChip(
                            selected = p.status == "paid",
                            onClick = { viewModel.togglePostGamePayment(p.playerName) },
                            label = { Text("${p.playerName} %.2f".format(p.amount)) },
                            leadingIcon = if (p.status == "paid") { { Icon(Icons.Default.CheckCircle, null, Modifier.size(16.dp)) } } else null,
                        )
                    }
                }
                if (state.postGamePaymentsDirty) {
                    Button(onClick = { viewModel.savePostGamePayments(eventId) }, enabled = !state.postGameSaving, modifier = Modifier.fillMaxWidth()) {
                        Text(stringResource(R.string.save), fontWeight = FontWeight.Bold)
                    }
                }
            }

            // Task 3 — MVP
            if (pg.mvpEnabled) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Icon(if (mvpDone) Icons.Default.CheckCircle else Icons.Default.RadioButtonUnchecked, null, Modifier.size(20.dp))
                    Text(
                        if (pg.mvpComplete) stringResource(R.string.post_game_mvp_done) else stringResource(R.string.post_game_mvp_pending),
                        style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f),
                    )
                }
                if (pg.isPlayer && !pg.mvpComplete && pg.latestHistoryId != null) {
                    Button(onClick = { onVoteMvp(pg.latestHistoryId!!) }, modifier = Modifier.fillMaxWidth()) {
                        Text(stringResource(R.string.post_game_vote_mvp_button))
                    }
                }
            }

            Text(
                stringResource(R.string.post_game_progress, done, total),
                style = MaterialTheme.typography.labelSmall,
                modifier = Modifier.align(Alignment.CenterHorizontally),
            )
        }
    }
}

/** Overflow menu with the secondary destinations. */
@Composable
private fun HeroMoreMenu(event: EventDetail, state: EventScreenState, viewModel: EventDetailViewModel, eventId: String, nav: ProtoNav) {
    var open by remember { mutableStateOf(false) }
    val context = LocalContext.current
    Box {
        IconButton(onClick = { open = true }) { Icon(Icons.Default.MoreVert, "More actions") }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            DropdownMenuItem(text = { Text(stringResource(R.string.share)) }, onClick = {
                open = false
                val url = viewModel.getShareUrl(eventId)
                val spots = event.maxPlayers - event.players.size
                val text = "${sportEmoji(event.sport)} ${event.title}\n${formatEventDateInTz(event.dateTime, event.timezone)}" +
                    (if (event.location.isNotBlank()) "\n📍 ${event.location}" else "") +
                    "\n👥 ${if (spots > 0) "$spots spot(s) left" else "Full"}\n\n$url"
                context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply { type = "text/plain"; putExtra(Intent.EXTRA_TEXT, text) }, context.getString(R.string.share)))
            })
            DropdownMenuItem(text = { Text(stringResource(R.string.rankings)) }, onClick = { open = false; nav.onRankings() })
            DropdownMenuItem(text = { Text("Payments page") }, onClick = { open = false; nav.onPayments() })
            DropdownMenuItem(text = { Text(stringResource(R.string.history)) }, onClick = { open = false; nav.onAllHistory() })
            DropdownMenuItem(text = { Text("Attendance") }, onClick = { open = false; nav.onAttendance() })
            DropdownMenuItem(text = { Text("Activity log") }, onClick = { open = false; nav.onLog() })
            if (event.sport in dev.convocados.ui.screen.courts.PLAYTOMIC_SPORTS)
                DropdownMenuItem(text = { Text(stringResource(R.string.courts)) }, onClick = { open = false; nav.onCourtAlternatives() })
            DropdownMenuItem(text = { Text(stringResource(R.string.alerts)) }, onClick = { open = false; nav.onNotificationPrefs() })
            if (state.isAdmin || event.ownerId == null)
                DropdownMenuItem(text = { Text(stringResource(R.string.settings)) }, onClick = { open = false; nav.onSettings() })
        }
    }
}

@Composable
private fun PulsingDot(color: Color) {
    val transition = rememberInfiniteTransition(label = "pulse")
    val alpha by transition.animateFloat(
        initialValue = 1f, targetValue = 0.2f,
        animationSpec = infiniteRepeatable(tween(750), RepeatMode.Reverse), label = "pulseAlpha",
    )
    Box(Modifier.size(14.dp).alpha(alpha).background(color, CircleShape))
}

@Composable
private fun HeroTeamColumn(
    team: dev.convocados.data.api.TeamResult,
    event: EventDetail,
    toTeamOne: Boolean,
    viewModel: EventDetailViewModel,
    eventId: String,
    modifier: Modifier = Modifier,
    headerColor: Color = MaterialTheme.colorScheme.primary,
) {
    Column(modifier.clip(RoundedCornerShape(12.dp)).background(headerColor.copy(alpha = 0.08f)).padding(10.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Text(team.name, color = headerColor, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold)
        team.members.forEach { m ->
            val pid = event.players.find { it.name == m.name }?.id
            Text(
                m.name,
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.padding(top = 4.dp).then(
                    if (pid != null) Modifier.clickable { viewModel.movePlayerToTeam(eventId, pid, m.name, toTeamOne) } else Modifier
                ),
            )
        }
    }
}

/** Compact roster group used inside the players card. */
@Composable
private fun PlayerGroup(
    players: List<dev.convocados.data.api.Player>,
    user: UserProfile?,
    isOwner: Boolean,
    isBench: Boolean,
    viewModel: EventDetailViewModel,
    eventId: String,
    nav: ProtoNav,
) {
    players.forEachIndexed { i, p ->
        PlayerRow(
            player = p,
            isMe = p.userId != null && p.userId == user?.id,
            isBench = isBench,
            canRemove = isOwner || p.userId == user?.id || p.userId == null,
            onRemove = { viewModel.removePlayer(eventId, p.id) },
            onUserClick = p.userId?.let { { nav.onUserClick(it) } } ?: {},
        )
        if (i < players.lastIndex) HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
    }
}
