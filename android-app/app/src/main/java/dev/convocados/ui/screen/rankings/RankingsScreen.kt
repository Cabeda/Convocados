package dev.convocados.ui.screen.rankings

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.HowToReg
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
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import dev.convocados.data.api.ConvocadosApi
import dev.convocados.data.api.EventDetail
import dev.convocados.data.api.Player
import dev.convocados.data.api.PlayerRating
import dev.convocados.data.api.UserProfile
import dev.convocados.ui.theme.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class RankingRow(
    val name: String,
    val rating: Int?,
    val gamesPlayed: Int,
    val wins: Int,
    val draws: Int,
    val losses: Int,
    val playerId: String?,
    val userId: String?,
)

@HiltViewModel
class RankingsViewModel @Inject constructor(
    private val api: ConvocadosApi,
) : ViewModel() {
    private val _ratings = MutableStateFlow<List<PlayerRating>>(emptyList())
    val ratings: StateFlow<List<PlayerRating>> = _ratings
    private val _event = MutableStateFlow<EventDetail?>(null)
    val event: StateFlow<EventDetail?> = _event
    private val _loading = MutableStateFlow(true)
    val loading: StateFlow<Boolean> = _loading
    private val _refreshing = MutableStateFlow(false)
    val refreshing: StateFlow<Boolean> = _refreshing
    private val _user = MutableStateFlow<UserProfile?>(null)
    val user: StateFlow<UserProfile?> = _user

    init {
        viewModelScope.launch { runCatching { _user.value = api.fetchUserInfo() } }
    }

    fun load(id: String) {
        viewModelScope.launch {
            _loading.value = true
            val evResult = runCatching { api.fetchEvent(id) }
            val ratResult = runCatching { api.fetchRatings(id) }
            evResult.onSuccess { _event.value = it }
            ratResult.onSuccess { _ratings.value = it.data }
            _loading.value = false
            _refreshing.value = false
        }
    }

    fun refresh(id: String) {
        _refreshing.value = true
        load(id)
    }

    fun claimPlayer(eventId: String, playerId: String) {
        viewModelScope.launch {
            runCatching { api.claimPlayer(eventId, playerId) }
                .onSuccess { load(eventId) }
        }
    }
}

private fun mergeRows(
    ratings: List<PlayerRating>,
    players: List<Player>,
): List<RankingRow> {
    val seen = mutableSetOf<String>()
    val rows = mutableListOf<RankingRow>()

    for (r in ratings) {
        val p = players.find { it.name.lowercase() == r.name.lowercase() }
        rows.add(RankingRow(
            name = r.name,
            rating = r.rating,
            gamesPlayed = r.gamesPlayed,
            wins = r.wins,
            draws = r.draws,
            losses = r.losses,
            playerId = p?.id,
            userId = p?.userId,
        ))
        seen.add(r.name.lowercase())
    }

    for (p in players) {
        if (p.name.lowercase() !in seen) {
            rows.add(RankingRow(
                name = p.name,
                rating = null,
                gamesPlayed = 0,
                wins = 0,
                draws = 0,
                losses = 0,
                playerId = p.id,
                userId = p.userId,
            ))
        }
    }

    return rows
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RankingsScreen(
    eventId: String,
    onBack: () -> Unit,
    viewModel: RankingsViewModel = hiltViewModel(),
) {
    val ratings by viewModel.ratings.collectAsStateWithLifecycle()
    val event by viewModel.event.collectAsStateWithLifecycle()
    val loading by viewModel.loading.collectAsStateWithLifecycle()
    val refreshing by viewModel.refreshing.collectAsStateWithLifecycle()
    val user by viewModel.user.collectAsStateWithLifecycle()

    LaunchedEffect(eventId) { viewModel.load(eventId) }

    val players = event?.players ?: emptyList()
    val rows = mergeRows(ratings, players)
    val userHasLinkedPlayer = user != null && players.any { it.userId == user?.id }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("\uD83C\uDFC6 Rankings") },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Bg),
            )
        },
        containerColor = Bg,
    ) { padding ->
        if (loading) {
            Box(Modifier.fillMaxSize().padding(padding), Alignment.Center) {
                CircularProgressIndicator(color = Primary)
            }
            return@Scaffold
        }

        if (rows.isEmpty()) {
            Box(Modifier.fillMaxSize().padding(padding), Alignment.Center) {
                Text("No ratings yet", color = TextMuted)
            }
            return@Scaffold
        }

        PullToRefreshBox(
            isRefreshing = refreshing,
            onRefresh = { viewModel.refresh(eventId) },
            modifier = Modifier.fillMaxSize().padding(padding),
        ) {
            LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                itemsIndexed(rows, key = { _, r -> r.name }) { index, r ->
                    val canClaim = user != null && !userHasLinkedPlayer && r.userId == null && r.playerId != null

                    Card(colors = CardDefaults.cardColors(containerColor = Surface), modifier = Modifier.fillMaxWidth()) {
                        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text("#${index + 1}", color = TextMuted, fontWeight = FontWeight.Bold, modifier = Modifier.width(28.dp))
                            Column(Modifier.weight(1f)) {
                                Text(r.name, color = TextPrimary, fontWeight = FontWeight.Bold, fontSize = 15.sp)
                                if (r.rating != null) {
                                    Text("${r.gamesPlayed}g \u00B7 W${r.wins}/D${r.draws}/L${r.losses}", color = TextSecondary, fontSize = 12.sp)
                                } else {
                                    Text("New player", color = TextSecondary, fontSize = 12.sp)
                                }
                            }
                            if (r.rating != null) {
                                Text(
                                    "${r.rating}",
                                    color = when {
                                        r.rating >= 1200 -> Success
                                        r.rating >= 1000 -> Primary
                                        else -> Warning
                                    },
                                    fontSize = 16.sp,
                                    fontWeight = FontWeight.ExtraBold,
                                )
                            } else {
                                Text("\u2014", color = TextMuted, fontSize = 16.sp, fontWeight = FontWeight.ExtraBold)
                            }
                            if (canClaim) {
                                IconButton(
                                    onClick = { viewModel.claimPlayer(eventId, r.playerId!!) },
                                    modifier = Modifier.size(36.dp).padding(start = 8.dp),
                                ) {
                                    Icon(Icons.Default.HowToReg, "Claim as me", tint = Primary, modifier = Modifier.size(24.dp))
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
