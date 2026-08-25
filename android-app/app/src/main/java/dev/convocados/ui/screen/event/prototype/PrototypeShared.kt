package dev.convocados.ui.screen.event.prototype

/*
 * PROTOTYPE — THROWAWAY. Shared dialogs/sheets + add-player widget used by all
 * variants (identical UX across variants; layout lives in the variant files).
 */

import android.app.Activity
import android.content.Intent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Contacts
import androidx.compose.material.icons.filled.PersonAdd
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.convocados.R
import dev.convocados.data.api.UserProfile
import dev.convocados.ui.screen.event.EventDetailViewModel
import dev.convocados.ui.screen.event.EventScreenState
import dev.convocados.ui.screen.event.PendingAdd

/** Notification sheet + payment nudge + add-player confirm, identical everywhere. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun PrototypeOverlays(
    eventId: String,
    state: EventScreenState,
    user: UserProfile?,
    viewModel: EventDetailViewModel,
    pendingAdd: PendingAdd?,
    onDismissPendingAdd: () -> Unit,
) {
    // Notification preferences bottom sheet
    if (state.showNotificationSheet) {
        ModalBottomSheet(onDismissRequest = { viewModel.dismissNotificationSheet() }) {
            Column(Modifier.padding(horizontal = 24.dp).padding(bottom = 24.dp)) {
                Text(stringResource(R.string.notification_settings), style = MaterialTheme.typography.titleLarge)
                Spacer(Modifier.height(16.dp))
                ToggleRow(stringResource(R.string.player_activity), state.mutePlayerActivity) { v ->
                    viewModel.updateNotificationOverride(eventId, "mutePlayerActivity", v)
                }
                ToggleRow(stringResource(R.string.game_reminders), state.muteReminders) { v ->
                    viewModel.updateNotificationOverride(eventId, "muteReminders", v)
                }
                ToggleRow(stringResource(R.string.post_game_results), state.mutePostGame) { v ->
                    viewModel.updateNotificationOverride(eventId, "mutePostGame", v)
                }
                ToggleRow(stringResource(R.string.event_changes), state.muteEventDetails) { v ->
                    viewModel.updateNotificationOverride(eventId, "muteEventDetails", v)
                }
                if (state.isAdmin) {
                    Spacer(Modifier.height(12.dp))
                    HorizontalDivider()
                    Text(
                        stringResource(R.string.notify_admin_section_title),
                        style = MaterialTheme.typography.titleSmall,
                        color = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.padding(top = 12.dp),
                    )
                    Text(
                        stringResource(R.string.notify_admin_section_desc),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                if (!state.isPlayer) {
                    Spacer(Modifier.height(16.dp))
                    TextButton(onClick = { viewModel.unfollow(eventId) }, modifier = Modifier.fillMaxWidth()) {
                        Text(stringResource(R.string.unfollow), color = MaterialTheme.colorScheme.error)
                    }
                }
            }
        }
    }

    // Payment nudge dialog
    if (state.showPaymentNudge && user?.name != null) {
        val callerBalance = state.balance?.callerBalance
        val autoPayPref by viewModel.autoPayOnJoin.collectAsStateWithLifecycle()
        AlertDialog(
            onDismissRequest = { viewModel.dismissPaymentNudge() },
            title = { Text(stringResource(R.string.settle_up_title)) },
            text = {
                Column {
                    if (callerBalance != null) {
                        Text(stringResource(R.string.owe_amount, "%.2f".format(callerBalance.amount), callerBalance.gamesOwed))
                    }
                    state.balance?.aggregate?.let { agg ->
                        if (agg.totalCount > 0) {
                            Spacer(Modifier.height(8.dp))
                            Text(
                                stringResource(R.string.paid_for_last_game, agg.paidCount, agg.totalCount),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                    Spacer(Modifier.height(16.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            stringResource(R.string.always_show_payment),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.weight(1f),
                        )
                        Switch(checked = autoPayPref, onCheckedChange = { viewModel.setAutoPayOnJoin(it) })
                    }
                }
            },
            confirmButton = {
                Button(
                    onClick = { viewModel.markSentAndJoin(eventId, user!!.name) },
                    colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.tertiary),
                ) {
                    Text(
                        if (callerBalance != null) stringResource(R.string.pay_and_join, "%.2f".format(callerBalance.amount))
                        else stringResource(R.string.sent_confirmation),
                    )
                }
            },
            dismissButton = {
                TextButton(onClick = { viewModel.joinWithoutPaying(eventId, user!!.name) }) {
                    Text(stringResource(R.string.join_pay_later))
                }
            },
        )
    }

    // Add-player confirmation
    val pending = pendingAdd
    if (pending != null && user != null) {
        val ev = state.event
        val isBench = (ev?.players?.size ?: 0) >= (ev?.maxPlayers ?: 0)
        AlertDialog(
            onDismissRequest = onDismissPendingAdd,
            title = { Text("Add ${pending.name}?") },
            text = {
                Text(
                    when {
                        pending.email != null && isBench -> "${pending.name} will be invited by email (${pending.email}) and placed on the bench."
                        pending.email != null -> "${pending.name} will be invited by email (${pending.email})."
                        isBench -> "${pending.name} joins ${ev?.title} — the list is full, so they go to the bench."
                        else -> "${pending.name} joins ${ev?.title}."
                    }
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    viewModel.addPlayer(eventId, pending.name, link = false, email = pending.email)
                    onDismissPendingAdd()
                }) { Text(stringResource(R.string.add_button)) }
            },
            dismissButton = { TextButton(onClick = onDismissPendingAdd) { Text(stringResource(R.string.cancel)) } },
        )
    }
}

@Composable
private fun ToggleRow(label: String, muted: Boolean?, onToggle: (Boolean?) -> Unit) {
    Row(
        Modifier.fillMaxWidth().padding(vertical = 4.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, style = MaterialTheme.typography.bodyLarge)
        Switch(checked = muted != true, onCheckedChange = { c -> onToggle(if (c) null else true) })
    }
}

/**
 * Add-player field with autocomplete, contacts picker and known/co-play chips.
 * Behavior identical across variants; variants decide where it sits.
 */
@Composable
internal fun AddPlayerSection(
    eventId: String,
    state: EventScreenState,
    viewModel: EventDetailViewModel,
    onRequestPendingAdd: (PendingAdd) -> Unit,
    compact: Boolean = false,
    modifier: Modifier = Modifier,
) {
    var query by remember { mutableStateOf("") }
    var pickedEmail by remember { mutableStateOf<String?>(null) }
    val context = LocalContext.current
    val event = state.event ?: return
    val currentNames = remember(event.players) { event.players.map { it.name.lowercase() }.toSet() }

    val filtered by remember(currentNames, state.knownPlayers) {
        derivedStateOf {
            if (query.length >= 2)
                state.knownPlayers.filter { it.name.lowercase().contains(query.lowercase()) && it.name.lowercase() !in currentNames }.take(5)
            else emptyList()
        }
    }

    val contactPicker = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        if (result.resultCode == Activity.RESULT_OK) {
            result.data?.data?.let { uri ->
                runCatching {
                    context.contentResolver.query(
                        uri,
                        arrayOf(
                            android.provider.ContactsContract.CommonDataKinds.Email.ADDRESS,
                            android.provider.ContactsContract.CommonDataKinds.Email.DISPLAY_NAME,
                        ),
                        null, null, null,
                    )?.use { c ->
                        if (c.moveToFirst()) {
                            val contactName = c.getString(1)?.takeIf { it.isNotBlank() } ?: ""
                            val contactEmail = c.getString(0)?.takeIf { it.isNotBlank() }
                            if (contactEmail != null) {
                                viewModel.addPlayer(eventId, contactName, link = false, email = contactEmail)
                                query = ""
                            } else query = contactName
                        }
                    }
                }
            }
        }
    }

    Column(modifier, verticalArrangement = Arrangement.spacedBy(if (compact) 6.dp else 10.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(
                value = query,
                onValueChange = { query = it },
                placeholder = { Text(stringResource(R.string.add_player_placeholder)) },
                singleLine = true,
                modifier = Modifier.weight(1f),
                supportingText = pickedEmail?.let { { Text(stringResource(R.string.will_invite, it)) } },
                trailingIcon = {
                    IconButton(onClick = {
                        contactPicker.launch(Intent(Intent.ACTION_PICK, android.provider.ContactsContract.CommonDataKinds.Email.CONTENT_URI))
                    }) { Icon(Icons.Default.Contacts, stringResource(R.string.add_from_contacts), tint = MaterialTheme.colorScheme.primary) }
                },
            )
            Button(
                onClick = {
                    val em = pickedEmail
                    if (em != null) viewModel.addPlayer(eventId, query.trim(), link = false, email = em)
                    else viewModel.addPlayer(eventId, query.trim())
                    query = ""; pickedEmail = null
                },
                enabled = query.isNotBlank(),
            ) { Text(stringResource(R.string.add_button), fontWeight = FontWeight.Bold) }
        }

        // Autocomplete dropdown
        if (filtered.isNotEmpty()) {
            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) {
                Column {
                    filtered.forEach { s ->
                        Text(
                            stringResource(R.string.player_games_count, s.name, s.gamesPlayed),
                            modifier = Modifier.fillMaxWidth().clickable {
                                onRequestPendingAdd(PendingAdd(s.name)); query = ""
                            }.padding(horizontal = 16.dp, vertical = 10.dp),
                            style = MaterialTheme.typography.bodyMedium,
                        )
                    }
                }
            }
        }

        // Known-player quick-add chips (when input empty)
        val suggestions = state.knownPlayers.filter { it.name.lowercase() !in currentNames }.take(5)
        if (suggestions.isNotEmpty() && query.isBlank()) {
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                suggestions.forEach { s ->
                    AssistChip(
                        onClick = { onRequestPendingAdd(PendingAdd(s.name)) },
                        label = { Text("${s.name} (${s.gamesPlayed}g)") },
                    )
                }
            }
        }

        // ADR 0025 co-play suggestion chips (owner/admin)
        if (state.coPlaySuggestions.isNotEmpty() && query.isBlank()) {
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                state.coPlaySuggestions.forEach { s ->
                    AssistChip(
                        onClick = { viewModel.inviteSuggestion(eventId, s.userId) },
                        label = { Text(s.name) },
                        leadingIcon = { Icon(Icons.Default.PersonAdd, null, Modifier.size(16.dp)) },
                    )
                }
            }
        }
    }
}
