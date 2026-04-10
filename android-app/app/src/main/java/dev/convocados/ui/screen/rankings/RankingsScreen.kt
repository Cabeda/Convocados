package dev.convocados.ui.screen.rankings

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
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
import dev.convocados.data.api.PlayerRating
import dev.convocados.ui.theme.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class RankingsViewModel @Inject constructor(private val api: ConvocadosApi) : ViewModel() {
    private val _ratings = MutableStateFlow<List<PlayerRating>>(emptyList())
    val ratings: StateFlow<List<PlayerRating>> = _ratings
    private val _loading = MutableStateFlow(true)
    val loading: StateFlow<Boolean> = _loading

    fun load(id: String) {
        viewModelScope.launch {
            _loading.value = true
            runCatching { api.fetchRatings(id) }.onSuccess { _ratings.value = it.data }
            _loading.value = false
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RankingsScreen(eventId: String, onBack: () -> Unit, viewModel: RankingsViewModel = hiltViewModel()) {
    val ratings by viewModel.ratings.collectAsState()
    val loading by viewModel.loading.collectAsState()
    LaunchedEffect(eventId) { viewModel.load(eventId) }

    Scaffold(
        topBar = { TopAppBar(title = { Text("\uD83C\uDFC6 Rankings") }, navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } }, colors = TopAppBarDefaults.topAppBarColors(containerColor = Bg)) },
        containerColor = Bg,
    ) { padding ->
        if (loading) { Box(Modifier.fillMaxSize().padding(padding), Alignment.Center) { CircularProgressIndicator(color = Primary) }; return@Scaffold }
        if (ratings.isEmpty()) { Box(Modifier.fillMaxSize().padding(padding), Alignment.Center) { Text("No ratings yet", color = TextMuted) }; return@Scaffold }

        LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(padding)) {
            itemsIndexed(ratings, key = { _, r -> r.id }) { index, r ->
                Card(colors = CardDefaults.cardColors(containerColor = Surface), modifier = Modifier.fillMaxWidth()) {
                    Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text("#${index + 1}", color = TextMuted, fontWeight = FontWeight.Bold, modifier = Modifier.width(28.dp))
                        Column(Modifier.weight(1f)) {
                            Text(r.name, color = TextPrimary, fontWeight = FontWeight.Bold, fontSize = 15.sp)
                            Text("${r.gamesPlayed}g · W${r.wins}/D${r.draws}/L${r.losses}", color = TextSecondary, fontSize = 12.sp)
                        }
                        Text("${r.rating}", color = when { r.rating >= 1200 -> Success; r.rating >= 1000 -> Primary; else -> Warning }, fontSize = 16.sp, fontWeight = FontWeight.ExtraBold)
                    }
                }
            }
        }
    }
}
