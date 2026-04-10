package dev.convocados.ui.screen.payments

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import dev.convocados.data.api.ConvocadosApi
import dev.convocados.data.api.PaymentsResponse
import dev.convocados.ui.theme.*
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
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PaymentsScreen(eventId: String, onBack: () -> Unit, viewModel: PaymentsViewModel = hiltViewModel()) {
    val data by viewModel.data.collectAsState()
    val loading by viewModel.loading.collectAsState()
    LaunchedEffect(eventId) { viewModel.load(eventId) }

    Scaffold(
        topBar = { TopAppBar(title = { Text("\uD83D\uDCB0 Payments") }, navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } }, colors = TopAppBarDefaults.topAppBarColors(containerColor = Bg)) },
        containerColor = Bg,
    ) { padding ->
        if (loading) { Box(Modifier.fillMaxSize().padding(padding), Alignment.Center) { CircularProgressIndicator(color = Primary) }; return@Scaffold }
        val d = data ?: return@Scaffold

        LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(padding)) {
            // Summary
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    SummaryCard("Paid", "${d.summary.paidCount}", TextPrimary, Modifier.weight(1f))
                    SummaryCard("Pending", "${d.summary.pendingCount}", Warning, Modifier.weight(1f))
                    d.totalAmount?.let { SummaryCard("Total", "${d.currency ?: "€"}$it", TextPrimary, Modifier.weight(1f)) }
                }
            }
            if (d.payments.isEmpty()) {
                item { Box(Modifier.fillMaxWidth().padding(48.dp), Alignment.Center) { Text("No payments set up", color = TextMuted) } }
            }
            items(d.payments, key = { it.id }) { p ->
                Card(colors = CardDefaults.cardColors(containerColor = Surface), modifier = Modifier.fillMaxWidth(), onClick = { viewModel.toggle(eventId, p.playerName, p.status) }) {
                    Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(p.playerName, color = TextPrimary, fontWeight = FontWeight.SemiBold)
                            p.method?.let { Text(it, color = TextMuted, fontSize = 12.sp) }
                        }
                        d.totalAmount?.let { Text("${d.currency ?: "€"}${p.amount}", color = TextSecondary, fontSize = 14.sp, modifier = Modifier.padding(end = 10.dp)) }
                        Card(colors = CardDefaults.cardColors(containerColor = if (p.status == "paid") PrimaryDark else SurfaceHover)) {
                            Text(if (p.status == "paid") "✓ Paid" else "Pending", color = if (p.status == "paid") PrimaryContainer else TextMuted, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp))
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun SummaryCard(label: String, value: String, valueColor: androidx.compose.ui.graphics.Color, modifier: Modifier) {
    Card(colors = CardDefaults.cardColors(containerColor = Surface), modifier = modifier) {
        Column(Modifier.padding(12.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Text(value, color = valueColor, fontSize = 20.sp, fontWeight = FontWeight.ExtraBold)
            Text(label, color = TextMuted, fontSize = 11.sp)
        }
    }
}
