package dev.convocados.ui.screen.event.prototype

/*
 * PROTOTYPE — THROWAWAY. Variant C "Timeline":
 * lifecycle rail down left edge — NOW (phase) → BEFORE (RSVP + roster) →
 * TEAMS → AFTER (wrap-up + history). Hierarchy = game lifecycle.
 */

import android.content.Intent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.material3.SnackbarHostState
import dev.convocados.R
import dev.convocados.data.api.EventDetail
import dev.convocados.data.api.Player
import dev.convocados.data.api.UserProfile
import dev.convocados.ui.screen.event.EventDetailViewModel
import dev.convocados.ui.screen.event.EventScreenState
import dev.convocados.ui.screen.event.PendingAdd
import dev.convocados.ui.screen.games.formatEventDateInTz
import dev.convocados.ui.screen.games.sportEmoji

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun VariantTimeline(
    eventId: String,
    state: EventScreenState,
    user: UserProfile?,
    viewModel: EventDetailViewModel,
    nav: ProtoNav,
    snackbarHostState: SnackbarHostState,
    onRequestPendingAdd: (PendingAdd) -> Unit,
) {
    val event = state.event
    val context = LocalContext.current

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(event?.title ?: stringResource(R.string.event_fallback), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, maxLines = 1)
                        Text(event?.let { sportEmoji(it.sport) + " " + spotsLabelOf(it) } ?: "", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                },
                navigationIcon = { IconButton(onClick = nav.onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back)) } },
                actions = {
                    if (!state.isPlayer) {
                        IconButton(onClick = { viewModel.toggleFollow(eventId) }) {
                            Icon(if (state.isFollowing) Icons.Default.Bookmark else Icons.Default.BookmarkBorder,
                                contentDescription = if (state.isFollowing) stringResource(R.string.following) else stringResource(R.string.follow),
                                tint = if (state.isFollowing) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                    TimelineMenu(event, state, viewModel, eventId, nav)
                },
            )
        },
    ) { padding ->
        if (event == null) {
            Box(Modifier.fillMaxSize().padding(padding), Alignment.Center) { CircularProgressIndicator() }
            return@Scaffold
        }

        val phaseUi = rememberPhaseUi(event)
        val (accent, _) = phaseColors(phaseUi.phase)
        val active = activePlayersOf(event)
        val bench = benchPlayersOf(event)
        val isOwner = user?.id == event.ownerId && event.ownerId != null
        val myPlayer = user?.let { u -> event.players.find { it.name.equals(u.name, true) } }
        val ended = phaseUi.phase == EventPhase.PAST

        Column(
            Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp),
        ) {
            state.undoData?.let { undo ->
                Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant), modifier = Modifier.padding(top = 8.dp).fillMaxWidth().clickable { viewModel.undoRemove(eventId) }) {
                    Text(stringResource(R.string.removed_tap_undo, undo.name), color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(10.dp))
                }
            }

            // ── Node 1: NOW ──────────────────────────────────────────────
            TimelineNode(color = accent, title = "Now", subtitle = phaseUi.timeLine) {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    phaseUi.secondary?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    if (event.location.isNotBlank()) {
                        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.clickable {
                            runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, android.net.Uri.parse("geo:0,0?q=${android.net.Uri.encode(event.location)}"))) }
                        }) {
                            Icon(Icons.Default.Place, null, tint = accent, modifier = Modifier.size(16.dp))
                            Spacer(Modifier.width(4.dp))
                            Text(event.location, style = MaterialTheme.typography.bodyMedium, color = accent)
                        }
                    }
                    if (user?.name != null && !ended) {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 4.dp)) {
                            val joined = myPlayer != null
                            FilledTonalButton(onClick = { if (!joined) viewModel.addPlayer(eventId, user!!.name, true) }, enabled = !joined) {
                                Icon(Icons.Default.Check, null, Modifier.size(16.dp)); Text(if (joined) "In" else "Going")
                            }
                            OutlinedButton(onClick = { myPlayer?.let { viewModel.removePlayer(eventId, it.id) } }, enabled = joined) {
                                Text("Out")
                            }
                        }
                    }
                }
            }

            // ── Node 2: BEFORE ───────────────────────────────────────────
            var rosterOpen by rememberSaveable { mutableStateOf(true) }
            TimelineNode(
                color = MaterialTheme.colorScheme.primary,
                title = "Before",
                subtitle = "${active.size}/${event.maxPlayers} playing" + if (bench.isNotEmpty()) " · ${bench.size} on bench" else "",
                collapsible = true, expanded = rosterOpen, onToggle = { rosterOpen = it },
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    active.forEachIndexed { i, p ->
                        TimelinePlayerRow(p, i + 1, user, isOwner, viewModel, eventId, nav)
                        if (i < active.lastIndex) HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f))
                    }
                    if (bench.isNotEmpty()) {
                        Text("Bench", style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.tertiary)
                        bench.forEach { p ->
                            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(vertical = 2.dp)) {
                                Text("${p.name}${if (p.userId == user?.id) stringResource(R.string.you_suffix) else ""}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline, modifier = Modifier.weight(1f))
                                if (isOwner || p.userId == user?.id || p.userId == null)
                                    IconButton(onClick = { viewModel.removePlayer(eventId, p.id) }, modifier = Modifier.size(24.dp)) {
                                        Icon(Icons.Default.Close, stringResource(R.string.remove), Modifier.size(14.dp), tint = MaterialTheme.colorScheme.outline)
                                    }
                            }
                        }
                    }
                    if (event.invited.isNotEmpty())
                        Text("Invited: ${event.invited.joinToString { it.name }}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary)
                    if (event.declined.isNotEmpty())
                        Text("Declined: ${event.declined.joinToString { it.name }}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
                    AnimatedVisibility(visible = !ended) {
                        AddPlayerSection(eventId, state, viewModel, onRequestPendingAdd, compact = true)
                    }
                }
            }

            // ── Node 3: TEAMS ────────────────────────────────────────────
            var teamsOpen by rememberSaveable { mutableStateOf(false) }
            val teams = event.teamResults
            TimelineNode(
                color = MaterialTheme.colorScheme.secondary,
                title = "Teams",
                subtitle = if (teams?.size == 2) "${teams[0].name} vs ${teams[1].name}" else "Not picked yet",
                collapsible = true,
                expanded = teamsOpen || teams == null,
                onToggle = { if (teams != null) teamsOpen = it },
            ) {
                if (teams != null && teams.size == 2) {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        teams.forEachIndexed { ti, team ->
                            val headerColor = if (ti == 0) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.secondary
                            Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(headerColor.copy(alpha = 0.08f)).padding(10.dp)) {
                                Text(team.name, color = headerColor, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.labelLarge)
                                team.members.forEach { m ->
                                    val pid = event.players.find { it.name == m.name }?.id
                                    Text(m.name, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 3.dp).then(
                                        if (pid != null) Modifier.clickable { viewModel.movePlayerToTeam(eventId, pid, m.name, toTeamOne = ti == 0) } else Modifier))
                                }
                            }
                        }
                        AssistChip(onClick = { viewModel.randomize(eventId, event.balanced) }, label = { Text(stringResource(R.string.randomize)) })
                    }
                } else if (active.size >= 2) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(onClick = { viewModel.randomize(eventId, true) }, modifier = Modifier.weight(1f)) { Text(stringResource(R.string.teams_balanced)) }
                        OutlinedButton(onClick = { viewModel.randomize(eventId, false) }, modifier = Modifier.weight(1f)) { Text(stringResource(R.string.teams_random)) }
                    }
                } else Text("Need at least 2 players", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }

            // ── Node 4: AFTER ────────────────────────────────────────────
            var afterOpen by rememberSaveable { mutableStateOf(state.postGame?.let { !it.allComplete } ?: false) }
            TimelineNode(
                color = if (ended) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline,
                title = "After",
                subtitle = when {
                    ended -> "Wrap up the result"
                    state.history.isNotEmpty() -> "${state.history.size} past games"
                    else -> "Nothing yet"
                },
                collapsible = true, expanded = afterOpen, onToggle = { afterOpen = it },
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    val pg = state.postGame
                    if (pg != null && pg.isParticipant && !pg.allComplete &&
                        (pg.gameEnded || pg.hasPendingPastPayments || (pg.mvpEnabled && !pg.mvpComplete))) {
                        TaskRow(done = pg.hasScore, label = if (pg.hasScore) stringResource(R.string.post_game_score_done) else stringResource(R.string.record_final_score)) {
                            pg.latestHistoryId?.let { nav.onHistoryClick(it) }
                        }
                        if (pg.hasCost && !state.postGamePayments.isNullOrEmpty() && !pg.allPaid) {
                            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                state.postGamePayments.forEach { p ->
                                    FilterChip(selected = p.status == "paid", onClick = { viewModel.togglePostGamePayment(p.playerName) },
                                        label = { Text("${p.playerName} %.2f".format(p.amount)) })
                                }
                            }
                            if (state.postGamePaymentsDirty)
                                Button(onClick = { viewModel.savePostGamePayments(eventId) }, enabled = !state.postGameSaving) { Text(stringResource(R.string.save)) }
                        }
                        if (pg.mvpEnabled)
                            TaskRow(done = pg.mvpComplete, label = if (pg.mvpComplete) stringResource(R.string.post_game_mvp_done) else stringResource(R.string.post_game_mvp_pending)) {
                                if (!pg.mvpComplete && pg.isPlayer) pg.latestHistoryId?.let { nav.onHistoryClick(it) }
                            }
                    }
                    state.history.take(3).forEach { h ->
                        Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant), modifier = Modifier.fillMaxWidth().clickable { nav.onHistoryClick(h.id) }) {
                            Column(Modifier.padding(10.dp)) {
                                Text(formatEventDateInTz(h.dateTime, event.timezone), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.outline)
                                Text("${h.teamOneName} ${h.scoreOne ?: "-"} – ${h.scoreTwo ?: "-"} ${h.teamTwoName}", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                            }
                        }
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        TextButton(onClick = nav.onAllHistory) { Text(stringResource(R.string.view_log), style = MaterialTheme.typography.labelMedium) }
                        TextButton(onClick = nav.onPayments) { Text("Payments", style = MaterialTheme.typography.labelMedium) }
                    }
                }
            }

            Spacer(Modifier.height(96.dp))
        }
    }
}

/** One lifecycle node: rail marker + heading + collapsible content. */
@Composable
private fun TimelineNode(
    color: Color,
    title: String,
    subtitle: String?,
    collapsible: Boolean = false,
    expanded: Boolean = true,
    onToggle: (Boolean) -> Unit = {},
    content: @Composable ColumnScope.() -> Unit,
) {
    Row(Modifier.fillMaxWidth().padding(top = 14.dp).height(IntrinsicSize.Min)) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.width(28.dp)) {
            Box(Modifier.size(16.dp).clip(CircleShape).background(color), contentAlignment = Alignment.Center) {
                Box(Modifier.size(6.dp).clip(CircleShape).background(MaterialTheme.colorScheme.surface))
            }
            Box(Modifier.width(2.dp).weight(1f).background(color.copy(alpha = 0.25f)))
        }
        Column(Modifier.weight(1f).padding(start = 10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.weight(1f)) {
                    Text(title.uppercase(), style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.ExtraBold, color = color, letterSpacing = 1.2.sp, modifier = Modifier.semantics { heading() })
                    subtitle?.let { Text(it, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold) }
                }
                if (collapsible)
                    IconButton(onClick = { onToggle(!expanded) }, modifier = Modifier.size(32.dp)) {
                        Icon(if (expanded) Icons.Default.ExpandLess else Icons.Default.ExpandMore, if (expanded) "Collapse" else "Expand")
                    }
            }
            AnimatedVisibility(visible = expanded) {
                Column(Modifier.padding(top = 8.dp), content = content)
            }
            Spacer(Modifier.height(8.dp))
        }
    }
}

@Composable
private fun TaskRow(done: Boolean, label: String, onClick: () -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().clickable(onClick = onClick).padding(vertical = 4.dp)) {
        Icon(if (done) Icons.Default.CheckCircle else Icons.Default.RadioButtonUnchecked, null,
            tint = if (done) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline, modifier = Modifier.size(20.dp))
        Spacer(Modifier.width(8.dp))
        Text(label, style = MaterialTheme.typography.bodyMedium, fontWeight = if (done) FontWeight.Normal else FontWeight.SemiBold,
            textDecoration = if (done) TextDecoration.LineThrough else null,
            modifier = Modifier.weight(1f))
        Icon(Icons.Default.ChevronRight, null, Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun TimelinePlayerRow(
    p: Player, number: Int, user: UserProfile?, isOwner: Boolean,
    viewModel: EventDetailViewModel, eventId: String, nav: ProtoNav,
) {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        Text("$number", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.outline, modifier = Modifier.width(20.dp))
        dev.convocados.ui.screen.event.PlayerAvatar(
            name = p.name, image = p.image, isMe = p.userId != null && p.userId == user?.id,
            onClick = { p.userId?.let(nav.onUserClick) },
        )
        Spacer(Modifier.width(10.dp))
        Text(
            "${p.name}${if (p.userId == user?.id) stringResource(R.string.you_suffix) else ""}",
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = if (p.userId == user?.id) FontWeight.SemiBold else FontWeight.Normal,
            modifier = Modifier.weight(1f),
        )
        if (isOwner || p.userId == user?.id || p.userId == null)
            IconButton(onClick = { viewModel.removePlayer(eventId, p.id) }, modifier = Modifier.size(28.dp)) {
                Icon(Icons.Default.Close, stringResource(R.string.remove), Modifier.size(16.dp), tint = MaterialTheme.colorScheme.outline)
            }
    }
}

@Composable
private fun TimelineMenu(event: EventDetail?, state: EventScreenState, viewModel: EventDetailViewModel, eventId: String, nav: ProtoNav) {
    var open by remember { mutableStateOf(false) }
    val context = LocalContext.current
    Box {
        IconButton(onClick = { open = true }) { Icon(Icons.Default.MoreVert, "More actions") }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            DropdownMenuItem(text = { Text(stringResource(R.string.share)) }, onClick = {
                open = false
                val ev = event ?: return@DropdownMenuItem
                val url = viewModel.getShareUrl(eventId)
                val spots = ev.maxPlayers - ev.players.size
                val text = "${sportEmoji(ev.sport)} ${ev.title}\n${formatEventDateInTz(ev.dateTime, ev.timezone)}" +
                    (if (ev.location.isNotBlank()) "\n📍 ${ev.location}" else "") +
                    "\n👥 ${if (spots > 0) "$spots spot(s) left" else "Full"}\n\n$url"
                context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply { type = "text/plain"; putExtra(Intent.EXTRA_TEXT, text) }, context.getString(R.string.share)))
            })
            DropdownMenuItem(text = { Text(stringResource(R.string.rankings)) }, onClick = { open = false; nav.onRankings() })
            DropdownMenuItem(text = { Text("Payments page") }, onClick = { open = false; nav.onPayments() })
            DropdownMenuItem(text = { Text(stringResource(R.string.history)) }, onClick = { open = false; nav.onAllHistory() })
            DropdownMenuItem(text = { Text("Attendance") }, onClick = { open = false; nav.onAttendance() })
            DropdownMenuItem(text = { Text("Activity log") }, onClick = { open = false; nav.onLog() })
            if (event?.sport in dev.convocados.ui.screen.courts.PLAYTOMIC_SPORTS && event != null)
                DropdownMenuItem(text = { Text(stringResource(R.string.courts)) }, onClick = { open = false; nav.onCourtAlternatives() })
            DropdownMenuItem(text = { Text(stringResource(R.string.alerts)) }, onClick = { open = false; nav.onNotificationPrefs() })
            if (state.isAdmin || event?.ownerId == null)
                DropdownMenuItem(text = { Text(stringResource(R.string.settings)) }, onClick = { open = false; nav.onSettings() })
        }
    }
}
