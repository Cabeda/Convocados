package dev.convocados.ui.screen.user

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import dev.convocados.data.api.ConvocadosApi
import dev.convocados.data.api.PlayerStats
import dev.convocados.data.api.UserPublicProfile
import dev.convocados.ui.screen.stats.StatBox
import dev.convocados.ui.theme.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class UserProfileViewModel @Inject constructor(private val api: ConvocadosApi) : ViewModel() {
    private val _profile = MutableStateFlow<UserPublicProfile?>(null)
    val profile: StateFlow<UserPublicProfile?> = _profile
    private val _stats = MutableStateFlow<PlayerStats?>(null)
    val stats: StateFlow<PlayerStats?> = _stats
    private val _loading = MutableStateFlow(true)
    val loading: StateFlow<Boolean> = _loading

    fun load(userId: String) {
        viewModelScope.launch {
            _loading.value = true
            runCatching {
                val p = api.fetchUserProfile(userId)
                val s = runCatching { api.fetchUserStats(userId) }.getOrNull()
                _profile.value = p; _stats.value = s
            }
            _loading.value = false
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun UserProfileScreen(userId: String, onBack: () -> Unit, onEventClick: (String) -> Unit, viewModel: UserProfileViewModel = hiltViewModel()) {
    val profile by viewModel.profile.collectAsState()
    val stats by viewModel.stats.collectAsState()
    val loading by viewModel.loading.collectAsState()
    LaunchedEffect(userId) { viewModel.load(userId) }

    Scaffold(
        topBar = { TopAppBar(title = { Text(profile?.name ?: "Profile") }, navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } }, colors = TopAppBarDefaults.topAppBarColors(containerColor = Bg)) },
        containerColor = Bg,
    ) { padding ->
        if (loading) { Box(Modifier.fillMaxSize().padding(padding), Alignment.Center) { CircularProgressIndicator(color = Primary) }; return@Scaffold }
        val p = profile ?: run { Box(Modifier.fillMaxSize().padding(padding), Alignment.Center) { Text("User not found", color = Error) }; return@Scaffold }

        Column(Modifier.padding(padding).verticalScroll(rememberScrollState()).padding(16.dp)) {
            // Avatar + name
            Card(colors = CardDefaults.cardColors(containerColor = Surface), modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Surface(color = PrimaryDark, shape = CircleShape, modifier = Modifier.size(72.dp)) {
                        Box(Modifier.fillMaxSize(), Alignment.Center) {
                            Text(p.name.first().uppercase(), color = Primary, fontSize = 32.sp, fontWeight = FontWeight.ExtraBold)
                        }
                    }
                    Spacer(Modifier.height(12.dp))
                    Text(p.name, color = TextPrimary, fontSize = 22.sp, fontWeight = FontWeight.ExtraBold)
                }
            }

            stats?.let { s ->
                Spacer(Modifier.height(16.dp))
                Text("OVERVIEW", color = Primary, fontWeight = FontWeight.Bold, fontSize = 13.sp, letterSpacing = 1.sp)
                Spacer(Modifier.height(12.dp))
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    StatBox("Games", "${s.summary.totalGames}", Modifier.weight(1f))
                    StatBox("Wins", "${s.summary.totalWins}", Modifier.weight(1f))
                    StatBox("Draws", "${s.summary.totalDraws}", Modifier.weight(1f))
                }
                Spacer(Modifier.height(8.dp))
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    StatBox("Losses", "${s.summary.totalLosses}", Modifier.weight(1f))
                    StatBox("Win Rate", "${(s.summary.winRate * 100).toInt()}%", Modifier.weight(1f))
                    StatBox("Avg Rating", "${s.summary.avgRating}", Modifier.weight(1f))
                }

                if (s.events.isNotEmpty()) {
                    Spacer(Modifier.height(20.dp))
                    Text("PER EVENT", color = Primary, fontWeight = FontWeight.Bold, fontSize = 13.sp, letterSpacing = 1.sp)
                    Spacer(Modifier.height(12.dp))
                    s.events.forEach { ev ->
                        Card(colors = CardDefaults.cardColors(containerColor = Surface), modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp).clickable { onEventClick(ev.eventId) }) {
                            Column(Modifier.padding(14.dp)) {
                                Text(ev.eventTitle, color = TextPrimary, fontWeight = FontWeight.Bold, fontSize = 15.sp)
                                Text("${ev.gamesPlayed}g · Rating: ${ev.rating} · W${ev.wins}/D${ev.draws}/L${ev.losses}", color = TextSecondary, fontSize = 12.sp)
                            }
                        }
                    }
                }
            }
            Spacer(Modifier.height(40.dp))
        }
    }
}
