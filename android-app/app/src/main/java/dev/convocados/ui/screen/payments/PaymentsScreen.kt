package dev.convocados.ui.screen.payments

import androidx.compose.foundation.layout.*
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
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import dev.convocados.R
import dev.convocados.data.api.ConvocadosApi
import dev.convocados.data.api.PaymentsResponse
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class PaymentsViewModel @Inject constructor(private val api: ConvocadosApi) : ViewModel() {
    private val _data = MutableStateFlow<PaymentsResponse?>(null)
    val data: StateFlow<PaymentsResponse?> = _data
    private val _loading = MutableStateFlow(true)
    val loading: StateFlow<Boolean> = _loading

    fun load(id: String) {
        viewModelScope.launch {
            _loading.value = true
            runCatching { api.fetchPayments(id) }.onSuccess { _data.value = it }
            _loading.value = false
        }
    }

    fun toggle(eventId: String, playerName: String, currentStatus: String) {
        viewModelScope.launch {
            val newStatus = if (currentStatus == "paid") "pending" else "paid"
            runCatching { api.updatePaymentStatus(eventId, playerName, newStatus) }.onSuccess { load(eventId) }
        }
    }

    fun setCostOverride(eventId: String, playerName: String, amount: Double) {
        viewModelScope.launch {
            runCatching { api.setCostOverride(eventId, playerName, amount) }.onSuccess { load(eventId) }
        }
    }

    fun bulkMarkAllPaid(eventId: String) {
        viewModelScope.launch {
            runCatching { api.bulkMarkAllPaid(eventId) }.onSuccess { load(eventId) }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PaymentsScreen(eventId: String, onBack: () -> Unit, viewModel: PaymentsViewModel = hiltViewModel()) {
    val data by viewModel.data.collectAsState()
    val loading by viewModel.loading.collectAsState()
    var overrideTarget by remember { mutableStateOf<String?>(null) }
    var overrideAmount by remember { mutableStateOf("") }
    LaunchedEffect(eventId) { viewModel.load(eventId) }

    val scrollBehavior = TopAppBarDefaults.enterAlwaysScrollBehavior()
    Scaffold(
        modifier = Modifier.nestedScroll(scrollBehavior.nestedScrollConnection),
        topBar = { TopAppBar(scrollBehavior = scrollBehavior, title = { Text(stringResource(R.string.payments)) }, navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back)) } }, colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background)) },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        if (loading) { Box(Modifier.fillMaxSize().padding(padding), Alignment.Center) { CircularProgressIndicator(color = MaterialTheme.colorScheme.primary) }; return@Scaffold }
        val d = data ?: return@Scaffold

        LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(padding)) {
            // Summary
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    SummaryCard(stringResource(R.string.paid), "${d.summary.paidCount}", MaterialTheme.colorScheme.onSurface, Modifier.weight(1f))
                    SummaryCard(stringResource(R.string.pending), "${d.summary.pendingCount}", MaterialTheme.colorScheme.tertiary, Modifier.weight(1f))
                    d.totalAmount?.let { SummaryCard(stringResource(R.string.total), "${d.currency ?: "€"}$it", MaterialTheme.colorScheme.onSurface, Modifier.weight(1f)) }
                }
            }
            // Bulk mark all as paid
            if (d.payments.any { it.status != "paid" }) {
                item {
                    Button(
                        onClick = { viewModel.bulkMarkAllPaid(eventId) },
                        modifier = Modifier.fillMaxWidth(),
                        colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primaryContainer),
                    ) {
                        Text("✓ ${stringResource(R.string.mark_all_paid)}", color = MaterialTheme.colorScheme.onPrimaryContainer, fontWeight = FontWeight.SemiBold)
                    }
                }
            }
            if (d.payments.isEmpty()) {
                item { Box(Modifier.fillMaxWidth().padding(48.dp), Alignment.Center) { Text(stringResource(R.string.no_payments), color = MaterialTheme.colorScheme.outline) } }
            }
            items(d.payments, key = { it.id }) { p ->
                Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface), modifier = Modifier.fillMaxWidth(), onClick = { viewModel.toggle(eventId, p.playerName, p.status) }) {
                    Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(p.playerName, color = MaterialTheme.colorScheme.onSurface, fontWeight = FontWeight.SemiBold)
                            p.method?.let { Text(it, color = MaterialTheme.colorScheme.outline, style = MaterialTheme.typography.bodySmall) }
                        }
                        d.totalAmount?.let { Text("${d.currency ?: "€"}${p.amount}", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(end = 10.dp)) }
                        Card(colors = CardDefaults.cardColors(containerColor = if (p.status == "paid") MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceVariant)) {
                            Text(if (p.status == "paid") "✓ ${stringResource(R.string.paid)}" else stringResource(R.string.pending), color = if (p.status == "paid") MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.outline, style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp))
                        }
                        Spacer(Modifier.width(4.dp))
                        IconButton(onClick = { overrideTarget = p.playerName; overrideAmount = p.amount.toString() }, modifier = Modifier.size(32.dp)) {
                            Icon(Icons.Default.Edit, stringResource(R.string.set_custom_cost), tint = MaterialTheme.colorScheme.outline, modifier = Modifier.size(16.dp))
                        }
                    }
                }
            }
        }

        // Cost override dialog
        overrideTarget?.let { name ->
            AlertDialog(
                onDismissRequest = { overrideTarget = null },
                title = { Text(stringResource(R.string.custom_cost_for, name)) },
                text = {
                    OutlinedTextField(value = overrideAmount, onValueChange = { overrideAmount = it }, label = { Text(stringResource(R.string.amount)) }, singleLine = true, modifier = Modifier.fillMaxWidth())
                },
                confirmButton = {
                    TextButton(onClick = {
                        overrideAmount.toDoubleOrNull()?.let { viewModel.setCostOverride(eventId, name, it) }
                        overrideTarget = null
                    }) { Text(stringResource(R.string.save), color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Bold) }
                },
                dismissButton = {
                    TextButton(onClick = { overrideTarget = null }) { Text(stringResource(R.string.cancel)) }
                },
            )
        }
    }
}

@Composable
private fun SummaryCard(label: String, value: String, valueColor: androidx.compose.ui.graphics.Color, modifier: Modifier) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface), modifier = modifier) {
        Column(Modifier.padding(12.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Text(value, color = valueColor, style = MaterialTheme.typography.titleLarge)
            Text(label, color = MaterialTheme.colorScheme.outline, style = MaterialTheme.typography.labelSmall)
        }
    }
}
