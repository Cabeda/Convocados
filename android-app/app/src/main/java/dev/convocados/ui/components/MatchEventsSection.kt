package dev.convocados.ui.components

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.SportsSoccer
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import dev.convocados.R

/** The minimal player shape the match-event picker needs. */
data class MatchEventPlayer(val id: String, val name: String)

/** One recorded goal, as rendered by [MatchEventsSection]. */
data class MatchEventItem(
    val scorerName: String,
    val assistName: String? = null,
    val minute: Int? = null,
    /** How many goals this entry records. "X scored 3" is one row with count=3. */
    val count: Int = 1,
    val ownGoal: Boolean = false,
    val penalty: Boolean = false,
)

/** What the section should post when the user confirms a goal. */
data class MatchEventDraft(
    val scorerEventPlayerId: String,
    val scorerName: String,
    val team: String,
    val minute: Int?,
    val count: Int = 1,
    val ownGoal: Boolean,
    val penalty: Boolean,
)

/**
 * The post-game goals & assists timeline, shared by the event page's wrap-up and
 * the single-game history screen.
 *
 * Progressive disclosure: with no events recorded the section collapses to a
 * single low-emphasis "add goal details" affordance, so the common case — a game
 * nobody wants to annotate — stays quiet. The timeline only appears once someone
 * has actually logged a goal.
 */
@Composable
fun MatchEventsSection(
    events: List<MatchEventItem>,
    players: List<MatchEventPlayer>,
    loading: Boolean,
    saving: Boolean,
    onAdd: (MatchEventDraft) -> Unit,
    modifier: Modifier = Modifier,
    loadOnAppear: (() -> Unit)? = null,
) {
    var expanded by remember { mutableStateOf(false) }
    var showDialog by remember { mutableStateOf(false) }
    var scorer by remember { mutableStateOf<MatchEventPlayer?>(null) }
    var team by remember { mutableStateOf("one") }
    var ownGoal by remember { mutableStateOf(false) }
    var penalty by remember { mutableStateOf(false) }
    var minute by remember { mutableStateOf("") }
    var count by remember { mutableIntStateOf(1) }

    if (loadOnAppear != null) {
        LaunchedEffect(Unit) { loadOnAppear() }
    }

    if (showDialog) {
        AlertDialog(
            onDismissRequest = { showDialog = false },
            title = { Text(stringResource(R.string.match_events_add_goal)) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(stringResource(R.string.match_events_select_scorer))
                    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        players.forEach { p ->
                            FilterChip(selected = scorer?.id == p.id, onClick = { scorer = p }, label = { Text(p.name) })
                        }
                    }
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(stringResource(R.string.match_events_how_many))
                        OutlinedButton(
                            onClick = { if (count > 1) count-- },
                            enabled = count > 1,
                            contentPadding = androidx.compose.foundation.layout.PaddingValues(0.dp),
                            modifier = Modifier.size(36.dp),
                        ) { Text("−") }
                        Text(count.toString(), style = MaterialTheme.typography.titleMedium)
                        OutlinedButton(
                            onClick = { if (count < 99) count++ },
                            enabled = count < 99,
                            contentPadding = androidx.compose.foundation.layout.PaddingValues(0.dp),
                            modifier = Modifier.size(36.dp),
                        ) { Text("+") }
                    }
                    Text(stringResource(R.string.match_events_select_team))
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        FilterChip(selected = team == "one", onClick = { team = "one" }, label = { Text(stringResource(R.string.match_events_team_one)) })
                        FilterChip(selected = team == "two", onClick = { team = "two" }, label = { Text(stringResource(R.string.match_events_team_two)) })
                    }
                    OutlinedTextField(
                        value = minute,
                        onValueChange = { minute = it.filter { c -> c.isDigit() }.take(3) },
                        label = { Text(stringResource(R.string.match_events_minute_label)) },
                        singleLine = true,
                        modifier = Modifier.width(140.dp),
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        FilterChip(selected = ownGoal, onClick = { ownGoal = !ownGoal }, label = { Text(stringResource(R.string.match_events_own_goal)) })
                        FilterChip(selected = penalty, onClick = { penalty = !penalty }, label = { Text(stringResource(R.string.match_events_penalty)) })
                    }
                }
            },
            confirmButton = {
                TextButton(
                    enabled = scorer != null && !saving,
                    onClick = {
                        val picked = scorer ?: return@TextButton
                        onAdd(
                            MatchEventDraft(
                                scorerEventPlayerId = picked.id,
                                scorerName = picked.name,
                                team = team,
                                minute = minute.toIntOrNull(),
                                count = count,
                                ownGoal = ownGoal,
                                penalty = penalty,
                            ),
                        )
                        showDialog = false
                        scorer = null
                        minute = ""
                        count = 1
                        ownGoal = false
                        penalty = false
                    },
                ) { Text(stringResource(R.string.match_events_add_goal)) }
            },
            dismissButton = { TextButton(onClick = { showDialog = false }) { Text(stringResource(R.string.cancel)) } },
        )
    }

    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Default.SportsSoccer, contentDescription = null, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(6.dp))
            Text(stringResource(R.string.match_events_title), style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
            if (loading) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
        }

        if (events.isEmpty() && !loading) {
            if (!expanded) {
                // Collapsed: nothing recorded. Keep the surface quiet.
                TextButton(onClick = { expanded = true }, contentPadding = androidx.compose.foundation.layout.PaddingValues(0.dp)) {
                    Icon(Icons.Default.Add, contentDescription = null, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(6.dp))
                    Text(stringResource(R.string.match_events_add_details), style = MaterialTheme.typography.labelLarge)
                }
            } else {
                Text(stringResource(R.string.match_events_no_events), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                GoalButton(saving = saving, players = players, onOpen = { showDialog = true })
            }
        } else {
            events.forEach { e -> MatchEventRow(e) }
            GoalButton(saving = saving, players = players, onOpen = { showDialog = true })
        }
    }
}

@Composable
private fun GoalButton(saving: Boolean, players: List<MatchEventPlayer>, onOpen: () -> Unit) {
    if (players.isEmpty()) return
    OutlinedButton(onClick = onOpen, enabled = !saving, modifier = Modifier.fillMaxWidth()) {
        Text(stringResource(R.string.match_events_add_goal))
    }
}

@Composable
private fun MatchEventRow(e: MatchEventItem) {
    Column(Modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(stringResource(R.string.match_events_goal_by, e.scorerName), style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
            if (e.count > 1) {
                Spacer(Modifier.width(6.dp))
                Text(stringResource(R.string.match_events_times, e.count), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
            }
            val tags = buildList {
                if (e.ownGoal) add(stringResource(R.string.match_events_own_goal))
                if (e.penalty) add(stringResource(R.string.match_events_penalty))
            }
            if (tags.isNotEmpty()) {
                Text(tags.joinToString(" · "), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            e.minute?.let {
                Spacer(Modifier.width(6.dp))
                Text(stringResource(R.string.match_events_minute, it), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        e.assistName?.let { assist ->
            Text(stringResource(R.string.match_events_assist_by, assist), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
