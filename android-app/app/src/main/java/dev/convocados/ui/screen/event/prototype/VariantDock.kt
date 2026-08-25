package dev.convocados.ui.screen.event.prototype

/*
 * PROTOTYPE — THROWAWAY. Variant B "Action dock":
 * compact app bar + horizontally scrollable info pills; the primary action
 * (join / pay & join / leave / full) lives in a persistent bottom dock so it
 * is always one thumb-reach away. Secondary destinations in overflow menu.
 */

import android.content.Intent
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.material3.SnackbarHostState
import dev.convocados.R
import dev.convocados.data.api.EventDetail
import dev.convocados.data.api.UserProfile
import dev.convocados.ui.screen.event.EventDetailViewModel
import dev.convocados.ui.screen.event.EventScreenState
import dev.convocados.ui.screen.event.PlayerRow
import dev.convocados.ui.screen.event.PendingAdd
import dev.convocados.ui.screen.games.formatEventDateInTz
import dev.convocados.ui.screen.games.sportEmoji

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun VariantDock(
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
    var menuOpen by remember { mutableStateOf(false) }
    var declinedOpen by remember { mutableStateOf(false) }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            TopAppBar(
                title = { Text(event?.title ?: stringResource(R.string.event_fallback), maxLines = 1, fontWeight = FontWeight.Bold) },
                navigationIcon = {
                    IconButton(onClick = nav.onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back)) }
                },
                actions = {
                    if (!state.isPlayer) {
                        IconButton(onClick = { viewModel.toggleFollow(eventId) }) {
                            Icon(
                                if (state.isFollowing) Icons.Default.Bookmark else Icons.Default.BookmarkBorder,
                                contentDescription = if (state.isFollowing) stringResource(R.string.following) else stringResource(R.string.follow),
                                tint = if (state.isFollowing) MaterialTheme.colorScheme.primary else LocalContentColor.current,
                            )
                        }
                    }
                    if (state.isFollowing) {
                        IconButton(onClick = { viewModel.showNotifications() }) {
                            Icon(Icons.Default.Notifications, stringResource(R.string.notification_settings))
                        }
                    }
                    Box {
                        IconButton(onClick = { menuOpen = true }) { Icon(Icons.Default.MoreVert, "More actions") }
                        DockMenu(event, state, viewModel, eventId, nav, expanded = menuOpen, onDismiss = { menuOpen = false })
                    }
                },
            )
        },
        bottomBar = {
            if (event != null) DockActionBar(eventId, event, state, user, viewModel)
        },
    ) { padding ->
        if (event == null) {
            Box(Modifier.fillMaxSize().padding(padding), Alignment.Center) { CircularProgressIndicator() }
            return@Scaffold
        }

        val phaseUi = rememberPhaseUi(event)
        val (accent, bg) = phaseColors(phaseUi.phase)
        val active = activePlayersOf(event)
        val bench = benchPlayersOf(event)
        val isOwner = user?.id == event.ownerId && event.ownerId != null
        val myPlayer = user?.let { u -> event.players.find { it.name.equals(u.name, true) } }

        Column(
            Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState()),
        ) {
            // ── Info pill strip ──────────────────────────────────────────
            Row(
                Modifier.padding(horizontal = 16.dp, vertical = 10.dp).horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                PillContainer(bg) {
                    Icon(Icons.Default.Schedule, null, tint = accent, modifier = Modifier.size(16.dp))
                    Text(phaseUi.timeLine, color = accent, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold)
                }
                if (event.location.isNotBlank()) PillContainer(MaterialTheme.colorScheme.surfaceVariant) {
                    Icon(Icons.Default.Place, null, modifier = Modifier.size(16.dp))
                    Text(event.location, style = MaterialTheme.typography.labelLarge)
                }
                PillContainer(MaterialTheme.colorScheme.surfaceVariant) {
                    Text(sportEmoji(event.sport), style = MaterialTheme.typography.labelMedium)
                    Text(spotsLabelOf(event), style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold)
                }
                if (event.isRecurring) PillContainer(MaterialTheme.colorScheme.secondaryContainer) {
                    Icon(Icons.Default.Repeat, null, modifier = Modifier.size(16.dp))
                    Text("Recurring", style = MaterialTheme.typography.labelLarge)
                }
            }

            Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {

                state.undoData?.let { undo ->
                    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) {
                        Text(
                            stringResource(R.string.removed_tap_undo, undo.name),
                            color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.SemiBold,
                            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                            modifier = Modifier.padding(12.dp).fillMaxWidth(),
                        )
                    }
                }

                // Post-game wrap-up — dense checklist
                val pg = state.postGame
                if (pg != null && pg.isParticipant && !pg.allComplete &&
                    (pg.gameEnded || pg.hasPendingPastPayments || (pg.mvpEnabled && !pg.mvpComplete))
                ) {
                    ElevatedCard(Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                Icon(Icons.Default.Celebration, null, Modifier.size(18.dp), tint = MaterialTheme.colorScheme.primary)
                                Text("Wrap-up", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.ExtraBold)
                                Spacer(Modifier.weight(1f))
                                Text(stringResource(R.string.post_game_progress,
                                    (if (pg.hasScore) 1 else 0) + (if (pg.allPaid || !pg.hasCost) 1 else 0) + (if (!pg.mvpEnabled || pg.mvpComplete) 1 else 0),
                                    2 + (if (pg.mvpEnabled) 1 else 0)),
                                    style = MaterialTheme.typography.labelSmall)
                            }
                            if (!pg.hasScore && pg.latestHistoryId != null)
                                ListItem(
                                    headlineContent = { Text(stringResource(R.string.record_final_score), style = MaterialTheme.typography.bodyMedium) },
                                    leadingContent = { Icon(Icons.Default.RadioButtonUnchecked, null, Modifier.size(18.dp)) },
                                    trailingContent = { Icon(Icons.Default.ChevronRight, null, Modifier.size(18.dp)) },
                                    colors = ListItemDefaults.colors(containerColor = Color.Transparent),
                                    modifier = Modifier.heightIn(min = 40.dp).clickable { nav.onHistoryClick(pg.latestHistoryId) },
                                )
                            if (pg.hasCost && !pg.allPaid && !state.postGamePayments.isNullOrEmpty()) {
                                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                    state.postGamePayments.forEach { p ->
                                        FilterChip(selected = p.status == "paid", onClick = { viewModel.togglePostGamePayment(p.playerName) },
                                            label = { Text("${p.playerName} %.2f".format(p.amount)) })
                                    }
                                }
                                if (state.postGamePaymentsDirty)
                                    Button(onClick = { viewModel.savePostGamePayments(eventId) }, enabled = !state.postGameSaving, modifier = Modifier.fillMaxWidth()) {
                                        Text(stringResource(R.string.save), fontWeight = FontWeight.Bold)
                                    }
                            }
                            if (pg.mvpEnabled && !pg.mvpComplete && pg.isPlayer && pg.latestHistoryId != null)
                                OutlinedButton(onClick = { nav.onHistoryClick(pg.latestHistoryId!!) }, modifier = Modifier.fillMaxWidth()) {
                                    Text(stringResource(R.string.post_game_vote_mvp_button))
                                }
                        }
                    }
                }

                // Debt banner when relevant
                state.balance?.callerBalance?.let { cb ->
                    if (cb.amount > 0 && myPlayer == null && (state.balance.enforcement != "off")) {
                        Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer)) {
                            Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                                Icon(Icons.Default.WarningAmber, null, tint = MaterialTheme.colorScheme.onErrorContainer)
                                Spacer(Modifier.width(8.dp))
                                Text("You owe %.2f · settle to join".format(cb.amount), color = MaterialTheme.colorScheme.onErrorContainer, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodyMedium)
                            }
                        }
                    }
                }

                // Teams
                val teams = event.teamResults
                if (teams != null && teams.size == 2) {
                    Card(Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(14.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text("Teams", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f).semantics { heading() })
                                AssistChip(onClick = { viewModel.randomize(eventId, event.balanced) }, label = { Text(stringResource(R.string.randomize)) }, leadingIcon = { Icon(Icons.Default.Shuffle, null, Modifier.size(16.dp)) })
                            }
                            Row(Modifier.padding(top = 8.dp)) {
                                DockTeamColumn(teams[0], event, false, viewModel, eventId, Modifier.weight(1f), MaterialTheme.colorScheme.primary)
                                Text(stringResource(R.string.vs), color = MaterialTheme.colorScheme.outline, fontWeight = FontWeight.Bold, modifier = Modifier.align(Alignment.CenterVertically).padding(horizontal = 10.dp))
                                DockTeamColumn(teams[1], event, true, viewModel, eventId, Modifier.weight(1f), MaterialTheme.colorScheme.tertiary)
                            }
                        }
                    }
                } else if (active.size >= 2) {
                    Button(onClick = { viewModel.randomize(eventId, event.balanced) }, modifier = Modifier.fillMaxWidth()) {
                        Icon(Icons.Default.Shuffle, null, Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text(stringResource(R.string.randomize))
                    }
                }

                // Roster — single dense card with inline headers
                Card(Modifier.fillMaxWidth()) {
                    Column {
                        Row(Modifier.padding(horizontal = 14.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text(stringResource(R.string.playing_count, active.size, event.maxPlayers), style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f).semantics { heading() })
                        }
                        active.forEachIndexed { i, p ->
                            PlayerRow(player = p, isMe = p.userId == user?.id,
                                canRemove = isOwner || p.userId == user?.id || p.userId == null,
                                onRemove = { viewModel.removePlayer(eventId, p.id) },
                                onUserClick = p.userId?.let { { nav.onUserClick(it) } } ?: {})
                            if (i < active.lastIndex) HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                        }
                        if (bench.isNotEmpty()) {
                            HorizontalDivider(thickness = 2.dp, color = MaterialTheme.colorScheme.outlineVariant)
                            Text(stringResource(R.string.bench_count, bench.size), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.tertiary, fontWeight = FontWeight.Bold, modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp))
                            bench.forEachIndexed { i, p ->
                                PlayerRow(player = p, isMe = p.userId == user?.id, isBench = true,
                                    canRemove = isOwner || p.userId == user?.id || p.userId == null,
                                    onRemove = { viewModel.removePlayer(eventId, p.id) },
                                    onUserClick = p.userId?.let { { nav.onUserClick(it) } } ?: {})
                                if (i < bench.lastIndex) HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                            }
                        }
                        if (event.invited.isNotEmpty()) {
                            HorizontalDivider()
                            Text(stringResource(R.string.invited_count, event.invited.size), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Bold, modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp))
                            event.invited.forEach { Text("· ${it.name} — pending", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = 14.dp, vertical = 2.dp)) }
                        }
                        if (event.declined.isNotEmpty()) {
                            TextButton(onClick = { declinedOpen = !declinedOpen }, modifier = Modifier.padding(horizontal = 6.dp)) {
                                Text(if (declinedOpen) "Hide declined" else stringResource(R.string.declined_count, event.declined.size), style = MaterialTheme.typography.labelMedium)
                            }
                            if (declinedOpen) event.declined.forEach { Text("· ${it.name}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline, modifier = Modifier.padding(horizontal = 14.dp, vertical = 2.dp)) }
                        }
                        HorizontalDivider()
                        AddPlayerSection(eventId, state, viewModel, onRequestPendingAdd, compact = true,
                            modifier = Modifier.padding(14.dp))
                    }
                }

                // History preview rows
                if (state.history.isNotEmpty()) {
                    Card(Modifier.fillMaxWidth()) {
                        Column {
                            Row(Modifier.padding(horizontal = 14.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                                Text("History", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f).semantics { heading() })
                                TextButton(onClick = nav.onAllHistory) { Text("All", style = MaterialTheme.typography.labelMedium) }
                            }
                            state.history.take(3).forEach { h ->
                                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                                ListItem(
                                    headlineContent = { Text("${h.teamOneName} ${h.scoreOne ?: "-"} – ${h.scoreTwo ?: "-"} ${h.teamTwoName}", style = MaterialTheme.typography.bodyMedium) },
                                    supportingContent = { Text(formatEventDateInTz(h.dateTime, event.timezone), style = MaterialTheme.typography.bodySmall) },
                                    trailingContent = {
                                        h.eloUpdates?.takeIf { it.isNotEmpty() }?.firstOrNull()?.let { eu ->
                                            Text("${eu.name} ${if (eu.delta > 0) "+" else ""}${eu.delta}", style = MaterialTheme.typography.labelSmall, color = if (eu.delta > 0) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error, fontWeight = FontWeight.SemiBold)
                                        }
                                    },
                                    colors = ListItemDefaults.colors(containerColor = Color.Transparent),
                                    modifier = Modifier.clickable { nav.onHistoryClick(h.id) }.heightIn(min = 52.dp),
                                )
                            }
                        }
                    }
                }
                Spacer(Modifier.height(24.dp))
            }
        }
    }
}

/** Persistent bottom dock: share | follow | primary CTA. */
@Composable
private fun DockActionBar(eventId: String, event: EventDetail, state: EventScreenState, user: UserProfile?, viewModel: EventDetailViewModel) {
    Surface(shadowElevation = 12.dp, color = MaterialTheme.colorScheme.surface) {
        Row(
            Modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 12.dp, vertical = 10.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            val context = LocalContext.current
            OutlinedIconButton(onClick = {
                val url = viewModel.getShareUrl(eventId)
                val spots = event.maxPlayers - event.players.size
                val text = "${sportEmoji(event.sport)} ${event.title}\n${formatEventDateInTz(event.dateTime, event.timezone)}" +
                    (if (event.location.isNotBlank()) "\n📍 ${event.location}" else "") +
                    "\n👥 ${if (spots > 0) "$spots spot(s) left" else "Full"}\n\n$url"
                context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply { type = "text/plain"; putExtra(Intent.EXTRA_TEXT, text) }, context.getString(R.string.share)))
            }) { Icon(Icons.Default.Share, stringResource(R.string.share)) }

            if (!state.isPlayer) {
                OutlinedIconButton(onClick = { viewModel.toggleFollow(eventId) }) {
                    Icon(
                        if (state.isFollowing) Icons.Default.Bookmark else Icons.Default.BookmarkBorder,
                        contentDescription = if (state.isFollowing) stringResource(R.string.following) else stringResource(R.string.follow),
                        tint = if (state.isFollowing) MaterialTheme.colorScheme.primary else LocalContentColor.current,
                    )
                }
            }

            val myPlayer = user?.let { u -> event.players.find { it.name.equals(u.name, true) } }
            val isOnBench = myPlayer != null && event.players.indexOf(myPlayer) >= event.maxPlayers
            val callerBalance = state.balance?.callerBalance
            val hasDebt = callerBalance != null && callerBalance.amount > 0
            val enforcement = state.balance?.enforcement ?: "off"
            val ended = runCatching {
                java.time.Instant.now() >= java.time.Instant.parse(event.dateTime).plus(java.time.Duration.ofMinutes(event.durationMinutes.toLong()))
            }.getOrDefault(false)

            if (user == null || ended) {
                Spacer(Modifier.weight(1f))
            } else if (myPlayer != null) {
                Column(Modifier.weight(1f)) {
                    Text(
                        if (isOnBench) stringResource(R.string.on_bench) else stringResource(R.string.joined_as, myPlayer.name),
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = FontWeight.SemiBold,
                        color = if (isOnBench) MaterialTheme.colorScheme.tertiary else MaterialTheme.colorScheme.primary,
                    )
                }
                OutlinedButton(onClick = { viewModel.removePlayer(eventId, myPlayer.id) }, colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error)) {
                    Text(stringResource(R.string.leave), fontWeight = FontWeight.Bold)
                }
            } else {
                Button(
                    onClick = {
                        if (hasDebt && enforcement != "off") viewModel.showPaymentNudge()
                        else viewModel.addPlayer(eventId, user!!.name, true)
                    },
                    enabled = !state.paymentGateBlocked,
                    modifier = Modifier.weight(1f).height(48.dp),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = if (hasDebt && enforcement != "off") MaterialTheme.colorScheme.tertiary else MaterialTheme.colorScheme.primary,
                    ),
                    shape = RoundedCornerShape(24.dp),
                ) {
                    Text(
                        if (hasDebt && enforcement != "off") stringResource(R.string.pay_and_join, "%.2f".format(callerBalance!!.amount))
                        else stringResource(R.string.join_as, user!!.name),
                        fontWeight = FontWeight.Bold,
                        maxLines = 1,
                    )
                }
            }
        }
    }
}

@Composable
private fun PillContainer(bg: Color, content: @Composable RowScope.() -> Unit) {
    Surface(shape = RoundedCornerShape(50), color = bg) {
        Row(Modifier.padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp), content = content)
    }
}

@Composable
private fun DockMenu(event: EventDetail?, state: EventScreenState, viewModel: EventDetailViewModel, eventId: String, nav: ProtoNav, expanded: Boolean, onDismiss: () -> Unit) {
    val context = LocalContext.current
    DropdownMenu(expanded = expanded, onDismissRequest = onDismiss) {
        DropdownMenuItem(text = { Text(stringResource(R.string.share)) }, onClick = {
            onDismiss()
            val ev = event ?: return@DropdownMenuItem
            val url = viewModel.getShareUrl(eventId)
            val spots = ev.maxPlayers - ev.players.size
            val text = "${sportEmoji(ev.sport)} ${ev.title}\n${formatEventDateInTz(ev.dateTime, ev.timezone)}" +
                (if (ev.location.isNotBlank()) "\n📍 ${ev.location}" else "") +
                "\n👥 ${if (spots > 0) "$spots spot(s) left" else "Full"}\n\n$url"
            context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply { type = "text/plain"; putExtra(Intent.EXTRA_TEXT, text) }, context.getString(R.string.share)))
        })
        DropdownMenuItem(text = { Text(stringResource(R.string.rankings)) }, onClick = { onDismiss(); nav.onRankings() })
        DropdownMenuItem(text = { Text("Payments page") }, onClick = { onDismiss(); nav.onPayments() })
        DropdownMenuItem(text = { Text(stringResource(R.string.history)) }, onClick = { onDismiss(); nav.onAllHistory() })
        DropdownMenuItem(text = { Text("Attendance") }, onClick = { onDismiss(); nav.onAttendance() })
        DropdownMenuItem(text = { Text("Activity log") }, onClick = { onDismiss(); nav.onLog() })
        if (event?.sport in dev.convocados.ui.screen.courts.PLAYTOMIC_SPORTS && event != null)
            DropdownMenuItem(text = { Text(stringResource(R.string.courts)) }, onClick = { onDismiss(); nav.onCourtAlternatives() })
        DropdownMenuItem(text = { Text(stringResource(R.string.alerts)) }, onClick = { onDismiss(); nav.onNotificationPrefs() })
        if (state.isAdmin || event?.ownerId == null)
            DropdownMenuItem(text = { Text(stringResource(R.string.settings)) }, onClick = { onDismiss(); nav.onSettings() })
    }
}

@Composable
private fun DockTeamColumn(team: dev.convocados.data.api.TeamResult, event: EventDetail, toTeamOne: Boolean, viewModel: EventDetailViewModel, eventId: String, modifier: Modifier, headerColor: Color) {
    Column(modifier.clip(RoundedCornerShape(12.dp)).background(headerColor.copy(alpha = 0.08f)).padding(10.dp)) {
        Text("${team.name} (${team.members.size})", color = headerColor, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold)
        team.members.forEach { m ->
            val pid = event.players.find { it.name == m.name }?.id
            Text(m.name, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 4.dp).then(
                if (pid != null) Modifier.clickable { viewModel.movePlayerToTeam(eventId, pid, m.name, toTeamOne) } else Modifier
            ))
        }
    }
}
