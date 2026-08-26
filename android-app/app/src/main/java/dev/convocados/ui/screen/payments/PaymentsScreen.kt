package dev.convocados.ui.screen.payments

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.background
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.draw.clip
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.res.stringResource
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import dev.convocados.R
import dev.convocados.data.api.ConvocadosApi
import dev.convocados.data.api.SettlementGame
import dev.convocados.data.api.SettlementSummary
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class PaymentsViewModel @Inject constructor(private val api: ConvocadosApi) : ViewModel() {
    private val _data = MutableStateFlow<SettlementSummary?>(null)
    val data: StateFlow<SettlementSummary?> = _data
    private val _loading = MutableStateFlow(true)
    val loading: StateFlow<Boolean> = _loading
    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error
    private val _busy = MutableStateFlow(false)
    val busy: StateFlow<Boolean> = _busy

    fun clearError() { _error.value = null }

    fun load(id: String) {
        viewModelScope.launch {
            _loading.value = true
            runCatching { api.fetchSettlement(id) }
                .onSuccess { _data.value = it }
                .onFailure { _error.value = it.message }
            _loading.value = false
        }
    }

    fun settle(eventId: String, gameId: String, eventPlayerId: String) = action { api.settleShare(eventId, gameId, eventPlayerId); load(eventId) }
    fun settleAll(eventId: String, gameId: String) = action { api.settleAll(eventId, gameId); load(eventId) }
    fun reportSent(eventId: String, gameId: String, eventPlayerId: String) = action { api.selfReportSent(eventId, gameId, eventPlayerId); load(eventId) }

    private fun action(block: suspend () -> Unit) {
        viewModelScope.launch {
            _busy.value = true
            runCatching { block() }.onFailure { _error.value = it.message }
            _busy.value = false
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PaymentsScreen(eventId: String, onBack: () -> Unit, viewModel: PaymentsViewModel = hiltViewModel()) {
    val data by viewModel.data.collectAsState()
    val loading by viewModel.loading.collectAsState()
    val error by viewModel.error.collectAsState()
    val busy by viewModel.busy.collectAsState()
    LaunchedEffect(eventId) { viewModel.load(eventId) }

    val snackbarHostState = remember { SnackbarHostState() }
    LaunchedEffect(error) {
        error?.let { snackbarHostState.showSnackbar(it); viewModel.clearError() }
    }

    val accent = MaterialTheme.colorScheme.primary
    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        if (loading) { Box(Modifier.fillMaxSize().padding(padding), Alignment.Center) { CircularProgressIndicator(color = accent) }; return@Scaffold }
        val d = data ?: run { Box(Modifier.fillMaxSize().padding(padding), Alignment.Center) { Text(stringResource(R.string.no_payments), color = MaterialTheme.colorScheme.outline) }; return@Scaffold }

        val isManager = d.viewerRole == "owner" || d.viewerRole == "admin"

        LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(padding)) {
            item {
                Box(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp))
                        .background(Brush.verticalGradient(listOf(accent.copy(alpha = 0.35f), MaterialTheme.colorScheme.surface)))
                        .padding(16.dp),
                ) {
                    Column {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            IconButton(onClick = onBack, modifier = Modifier.size(36.dp)) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back)) }
                            Spacer(Modifier.weight(1f))
                        }
                        Text(stringResource(R.string.payments_title), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.ExtraBold)
                        Text(stringResource(R.string.payments_intro), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }

            if (d.games.isEmpty()) {
                item { Card(Modifier.fillMaxWidth()) { Text(stringResource(R.string.payments_no_unsettled), color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(20.dp)) } }
            }

            // People rollup
            if (d.people.isNotEmpty()) {
                val payers = d.people.filter { it.isPayer }
                val debtors = d.people.filter { !it.isPayer }
                if (payers.isNotEmpty() || debtors.isNotEmpty()) {
                    item {
                        Card(Modifier.fillMaxWidth()) {
                            Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                if (payers.isNotEmpty()) {
                                    Text(stringResource(R.string.payments_to_receive), style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
                                    payers.forEach { p -> Text(stringResource(R.string.payments_is_owed, p.name, fmtMoney(p.owedToAmount)), style = MaterialTheme.typography.bodyMedium) }
                                }
                                if (debtors.isNotEmpty()) {
                                    if (payers.isNotEmpty()) HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                                    Text(stringResource(R.string.payments_to_pay), style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
                                    debtors.forEach { p -> Text(stringResource(R.string.payments_owes, p.name, fmtMoney(p.owedAmount)), style = MaterialTheme.typography.bodyMedium) }
                                }
                            }
                        }
                    }
                }
            }

            // Unsettled games
            if (d.games.isNotEmpty()) {
                item { Text(stringResource(R.string.payments_unsettled_games), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold) }
                items(d.games, key = { it.gameId }) { g ->
                    SettlementGameCard(g, isManager, busy, onMarkPaid = { ep -> viewModel.settle(eventId, g.gameId, ep) }, onSettleAll = { viewModel.settleAll(eventId, g.gameId) }, onReportSent = { ep -> viewModel.reportSent(eventId, g.gameId, ep) }, viewerEventPlayerId = d.viewerEventPlayerId)
                }
            }
        }
    }
}

@Composable
private fun SettlementGameCard(g: SettlementGame, isManager: Boolean, busy: Boolean, onMarkPaid: (String) -> Unit, onSettleAll: () -> Unit, onReportSent: (String) -> Unit, viewerEventPlayerId: String?) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface), modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(shortDate(g.dateTime), style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                    g.payerName?.let { Text(stringResource(R.string.payments_is_owed, it, fmtMoney(g.total)), color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall) }
                }
                if (isManager && g.debtorCount > 0) {
                    TextButton(onClick = onSettleAll, enabled = !busy) { Text(stringResource(R.string.payments_settle_all)) }
                }
            }
            g.rows.filter { it.status == "pending" || it.status == "sent" }.forEach { r ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(r.name, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
                    when (r.status) {
                        "sent" -> Text(stringResource(R.string.payments_status_sent), color = MaterialTheme.colorScheme.tertiary, style = MaterialTheme.typography.labelMedium)
                        else -> {
                            if (isManager) {
                                TextButton(onClick = { onMarkPaid(r.eventPlayerId) }, enabled = !busy) { Text(stringResource(R.string.payments_mark_paid)) }
                            } else if (r.eventPlayerId == viewerEventPlayerId) {
                                TextButton(onClick = { onReportSent(r.eventPlayerId) }, enabled = !busy) { Text(stringResource(R.string.payments_report_sent)) }
                            } else {
                                Text(stringResource(R.string.payments_status_pending), color = MaterialTheme.colorScheme.outline, style = MaterialTheme.typography.labelMedium)
                            }
                        }
                    }
                }
            }
        }
    }
}

private fun fmtMoney(amount: Double): String = "\u20AC%.2f".format(amount)

private fun shortDate(iso: String): String {
    val d = runCatching { java.time.Instant.parse(iso).atZone(java.time.ZoneId.systemDefault()) }.getOrNull() ?: return iso
    return d.format(java.time.format.DateTimeFormatter.ofPattern("dd MMM, HH:mm"))
}
