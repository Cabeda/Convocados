package dev.convocados.ui.screen.payments

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Payments
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import dev.convocados.R
import dev.convocados.data.api.ConvocadosApi
import dev.convocados.data.api.PayerState
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

/** Who is collecting for the current Game (ADR 0055). The role is a chore, not a privilege. */
@HiltViewModel
class PayerCardViewModel @Inject constructor(private val api: ConvocadosApi) : ViewModel() {
    private val _state = MutableStateFlow<PayerState?>(null)
    val state: StateFlow<PayerState?> = _state
    private val _busy = MutableStateFlow(false)
    val busy: StateFlow<Boolean> = _busy
    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error

    fun load(eventId: String) {
        viewModelScope.launch {
            runCatching { api.fetchPayer(eventId) }
                .onSuccess { _state.value = it }
                .onFailure { _error.value = it.message }
        }
    }

    fun claim(eventId: String) = act(eventId) { api.claimPayer(eventId) }

    fun standDown(eventId: String) = act(eventId) { api.standDownPayer(eventId) }

    private fun act(eventId: String, block: suspend () -> Unit) {
        viewModelScope.launch {
            _busy.value = true
            _error.value = null
            runCatching {
                block()
                _state.value = api.fetchPayer(eventId)
            }.onFailure { _error.value = it.message }
            _busy.value = false
        }
    }
}

@Composable
fun PayerCard(
    eventId: String,
    modifier: Modifier = Modifier,
    viewModel: PayerCardViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsState()
    val busy by viewModel.busy.collectAsState()
    val error by viewModel.error.collectAsState()
    var takeoverOpen by remember { mutableStateOf(false) }

    LaunchedEffect(eventId) { viewModel.load(eventId) }

    val s = state ?: return
    if (s.mode == "untracked" || !s.hasCost) return

    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        shape = RoundedCornerShape(12.dp),
        modifier = modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(horizontal = 12.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    Icons.Default.Payments,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(18.dp),
                )
                Spacer(Modifier.width(8.dp))
                if (s.vacant || s.payerName == null) {
                    Text(
                        stringResource(R.string.payer_card_vacant),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.weight(1f),
                    )
                    if (s.isRosterPlayer) {
                        OutlinedButton(onClick = { viewModel.claim(eventId) }, enabled = !busy) {
                            Text(stringResource(R.string.payer_card_claim))
                        }
                    }
                } else {
                    Text(
                        stringResource(R.string.payer_card_collecting, s.payerName),
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.weight(1f),
                    )
                    if (s.isPayer) {
                        TextButton(onClick = { viewModel.standDown(eventId) }, enabled = !busy) {
                            Text(stringResource(R.string.payer_card_stand_down))
                        }
                    } else if (s.isRosterPlayer) {
                        TextButton(onClick = { takeoverOpen = true }, enabled = !busy) {
                            Text(stringResource(R.string.payer_card_take_over, s.payerName))
                        }
                    }
                }
            }
            error?.let {
                Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.labelMedium)
            }
        }
    }

    if (takeoverOpen && s.payerName != null) {
        AlertDialog(
            onDismissRequest = { takeoverOpen = false },
            title = { Text(stringResource(R.string.payer_card_take_over_title)) },
            text = { Text(stringResource(R.string.payer_card_take_over_body, s.payerName)) },
            confirmButton = {
                TextButton(
                    onClick = {
                        takeoverOpen = false
                        viewModel.claim(eventId)
                    },
                    enabled = !busy,
                ) { Text(stringResource(R.string.confirm)) }
            },
            dismissButton = {
                TextButton(onClick = { takeoverOpen = false }, enabled = !busy) {
                    Text(stringResource(R.string.cancel))
                }
            },
        )
    }
}
