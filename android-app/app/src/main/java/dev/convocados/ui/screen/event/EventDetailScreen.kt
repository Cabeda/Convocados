package dev.convocados.ui.screen.event

import android.content.Intent
import androidx.compose.animation.AnimatedVisibilityScope
import androidx.compose.animation.ExperimentalSharedTransitionApi
import androidx.compose.animation.SharedTransitionScope
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import dev.convocados.data.api.*
import dev.convocados.data.auth.TokenStore
import dev.convocados.data.repository.EventRepository
import dev.convocados.ui.screen.games.formatRelativeDate
import dev.convocados.ui.theme.*
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

data class EventScreenState(
    val loading: Boolean = true,
    val refreshing: Boolean = false,
    val event: EventDetail? = null,
    val history: List<GameHistory> = emptyList(),
    val historyHasMore: Boolean = false,
    val historyCursor: String? = null,
    val knownPlayers: List<KnownPlayer> = emptyList(),
    val postGame: PostGameStatus? = null,
    val error: String? = null,
    val locked: Boolean = false,
    val undoData: UndoData? = null,
)

@OptIn(ExperimentalCoroutinesApi::class)
@HiltViewModel
class EventDetailViewModel @Inject constructor(
    private val repository: EventRepository,
    private val api: ConvocadosApi,
    private val tokenStore: TokenStore,
) : ViewModel() {
    private val _eventId = MutableStateFlow<String?>(null)

    val event = _eventId.flatMapLatest { id ->
        if (id == null) flowOf(null) else repository.getEventDetail(id)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), null)

    val players = _eventId.flatMapLatest { id ->
        if (id == null) flowOf(emptyList()) else repository.getPlayers(id)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    val history = _eventId.flatMapLatest { id ->
        if (id == null) flowOf(emptyList()) else repository.getHistory(id)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    private val _state = MutableStateFlow(EventScreenState(locked = true))
    val state: StateFlow<EventScreenState> = combine(_state, event, history) { s, e, h ->
        s.copy(
            event = e,
            history = h,
            loading = s.loading && e == null,
            locked = if (e?.locked == true) s.locked else false
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), EventScreenState(locked = true))

    private val _user = MutableStateFlow<UserProfile?>(null)
    val user: StateFlow<UserProfile?> = _user

    init {
        viewModelScope.launch { runCatching { _user.value = api.fetchUserInfo() } }
    }

    fun load(eventId: String) {
        _eventId.value = eventId
        viewModelScope.launch {
            _state.value = _state.value.copy(loading = event.value == null)
            repository.refreshEventDetail(eventId)
            val postGame = runCatching { api.fetchPostGameStatus(eventId) }.getOrNull()
            _state.value = _state.value.copy(loading = false, refreshing = false, postGame = postGame)
        }
    }

    fun refresh(eventId: String) {
        _state.value = _state.value.copy(refreshing = true)
        load(eventId)
    }

    fun addPlayer(eventId: String, name: String, link: Boolean = true) {
        viewModelScope.launch {
            repository.addPlayer(eventId, name, link)
                .onFailure { _state.value = _state.value.copy(error = it.message) }
        }
    }

    fun removePlayer(eventId: String, playerId: String) {
        viewModelScope.launch {
            repository.removePlayer(eventId, playerId)
                .onSuccess { undo ->
                    _state.value = _state.value.copy(undoData = undo)
                    delay(60_000)
                    _state.value = _state.value.copy(undoData = null)
                }
                .onFailure { _state.value = _state.value.copy(error = it.message) }
        }
    }

    fun undoRemove(eventId: String) {
        val undo = _state.value.undoData ?: return
        viewModelScope.launch {
            runCatching { api.undoRemovePlayer(eventId, undo) }
                .onSuccess {
                    _state.value = _state.value.copy(undoData = null)
                    repository.refreshEventDetail(eventId)
                }
        }
    }

    fun randomize(eventId: String, balanced: Boolean) {
        viewModelScope.launch {
            runCatching { api.randomizeTeams(eventId, balanced) }
                .onSuccess { repository.refreshEventDetail(eventId) }
        }
    }

    fun claimPlayer(eventId: String, playerId: String) {
        viewModelScope.launch {
            runCatching { api.claimPlayer(eventId, playerId) }
                .onSuccess { repository.refreshEventDetail(eventId) }
        }
    }

    fun saveScore(eventId: String, historyId: String, s1: Int, s2: Int) {
        viewModelScope.launch {
            runCatching { api.updateScore(eventId, historyId, s1, s2) }
                .onSuccess { repository.refreshEventDetail(eventId) }
        }
    }

    fun verifyPassword(eventId: String, password: String) {
        viewModelScope.launch {
            repository.verifyPassword(eventId, password)
                .onSuccess { _state.value = _state.value.copy(locked = false) }
                .onFailure { _state.value = _state.value.copy(error = "Incorrect password") }
        }
    }

    fun getShareUrl(eventId: String): String = "${tokenStore.getServerUrl()}/events/$eventId"
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalSharedTransitionApi::class)
@Composable
fun EventDetailScreen(
    eventId: String,
    onBack: () -> Unit,
    onSettings: () -> Unit,
    onRankings: () -> Unit,
    onPayments: () -> Unit,
    onLog: () -> Unit,
    onAttendance: () -> Unit,
    onNotificationPrefs: () -> Unit,
    onUserClick: (String) -> Unit,
    viewModel: EventDetailViewModel = hiltViewModel(),
    sharedTransitionScope: SharedTransitionScope,
    animatedVisibilityScope: AnimatedVisibilityScope,
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val event by viewModel.event.collectAsStateWithLifecycle()
    val players by viewModel.players.collectAsStateWithLifecycle()
    val history by viewModel.history.collectAsStateWithLifecycle()
    val user by viewModel.user.collectAsStateWithLifecycle()
    val context = LocalContext.current
    var newPlayer by remember { mutableStateOf("") }
    var editingScoreId by remember { mutableStateOf<String?>(null) }
    var scoreOne by remember { mutableStateOf("") }
    var scoreTwo by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }

    LaunchedEffect(eventId) { viewModel.load(eventId) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(event?.title ?: "Event", maxLines = 1) },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Bg),
            )
        },
        containerColor = Bg,
        modifier = with(sharedTransitionScope) {
            Modifier.sharedElement(
                rememberSharedContentState(key = "item-container-$eventId"),
                animatedVisibilityScope = animatedVisibilityScope
            )
        }
    ) { padding ->
        when {
            state.loading && event == null -> Box(Modifier.fillMaxSize().padding(padding), Alignment.Center) {
                CircularProgressIndicator(color = Primary)
            }
            state.locked -> {
                Column(Modifier.fillMaxSize().padding(padding).padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                    Text("\uD83D\uDD12 This game is password-protected", color = TextPrimary, fontWeight = FontWeight.Bold)
                    Spacer(Modifier.height(8.dp))
                    state.error?.let { Text(it, color = Error, fontSize = 13.sp) }
                    OutlinedTextField(value = password, onValueChange = { password = it }, placeholder = { Text("Password") }, singleLine = true, modifier = Modifier.fillMaxWidth().padding(top = 16.dp))
                    Button(onClick = { viewModel.verifyPassword(eventId, password.trim()) }, modifier = Modifier.fillMaxWidth().padding(top = 12.dp), colors = ButtonDefaults.buttonColors(containerColor = Primary)) {
                        Text("Unlock", color = OnPrimary, fontWeight = FontWeight.Bold)
                    }
                }
            }
            state.error != null && state.event == null -> {
                Column(Modifier.fillMaxSize().padding(padding).padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                    Text(state.error ?: "Event not found", color = Error)
                    TextButton(onClick = onBack) { Text("Go back", color = Primary) }
                }
            }
            else -> {
                val event = state.event ?: return@Scaffold
                val activePlayers = event.players.take(event.maxPlayers)
                val benchPlayers = event.players.drop(event.maxPlayers)
                val isOwner = user?.id == event.ownerId
                val myPlayer = user?.let { u -> event.players.find { it.name.equals(u.name, true) } }
                val isOnBench = myPlayer != null && event.players.indexOf(myPlayer) >= event.maxPlayers
                val canClaim = user != null && event.players.none { it.userId == user?.id }
                val currentNames = event.players.map { it.name.lowercase() }.toSet()
                val suggestions = state.knownPlayers.filter { it.name.lowercase() !in currentNames }.take(5)

                PullToRefreshBox(
                    isRefreshing = state.refreshing,
                    onRefresh = { viewModel.refresh(eventId) },
                    modifier = Modifier.fillMaxSize().padding(padding),
                ) {
                    Column(modifier = Modifier.verticalScroll(rememberScrollState()).padding(16.dp)) {
                        // Header
                        Text(event.title, color = TextPrimary, fontSize = 22.sp, fontWeight = FontWeight.ExtraBold)
                        Text(formatRelativeDate(event.dateTime), color = TextSecondary, fontSize = 14.sp)
                        if (event.location.isNotBlank()) Text(event.location, color = TextMuted, fontSize = 13.sp)

                        // Action bar
                        Row(modifier = Modifier.padding(vertical = 12.dp).horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            AssistChip(onClick = {
                                val url = viewModel.getShareUrl(eventId)
                                val spotsLeft = event.maxPlayers - event.players.size
                                val text = "\u26BD ${event.title}\n\uD83D\uDCC5 ${formatRelativeDate(event.dateTime)}" +
                                    (if (event.location.isNotBlank()) "\n\uD83D\uDCCD ${event.location}" else "") +
                                    "\n\uD83D\uDC65 ${if (spotsLeft > 0) "$spotsLeft spot(s) left" else "Full"}\n\n$url"
                                context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply { type = "text/plain"; putExtra(Intent.EXTRA_TEXT, text) }, "Share"))
                            }, label = { Text("\uD83D\uDCE4 Share") })
                            if (activePlayers.size >= 2) AssistChip(onClick = { viewModel.randomize(eventId, event.balanced) }, label = { Text("\uD83C\uDFB2 Randomize") })
                            if (isOwner || event.isAdmin) AssistChip(onClick = onSettings, label = { Text("\u2699\uFE0F") })
                            if (event.eloEnabled) AssistChip(onClick = onRankings, label = { Text("\uD83C\uDFC6 Rankings") })
                            AssistChip(onClick = onNotificationPrefs, label = { Text("\uD83D\uDD14") })
                        }

                        // Post-game banner — prominent, right after action bar
                        state.postGame?.let { pg ->
                            if (pg.gameEnded || pg.hasPendingPastPayments) {
                                Card(
                                    colors = CardDefaults.cardColors(containerColor = PrimaryDark),
                                    modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp),
                                ) {
                                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                                        Text("\uD83C\uDFC1 Game ended", color = PrimaryContainer, fontWeight = FontWeight.ExtraBold, fontSize = 18.sp)

                                        if (!pg.hasScore && pg.latestHistoryId != null) {
                                            if (editingScoreId == pg.latestHistoryId) {
                                                // Inline score entry
                                                Text("Record the final score", color = PrimaryContainer, fontSize = 13.sp)
                                                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                                    OutlinedTextField(
                                                        value = scoreOne, onValueChange = { scoreOne = it.filter { c -> c.isDigit() } },
                                                        modifier = Modifier.width(64.dp), singleLine = true, placeholder = { Text("0") },
                                                        colors = OutlinedTextFieldDefaults.colors(focusedTextColor = TextPrimary, unfocusedTextColor = TextPrimary, focusedBorderColor = Primary, unfocusedBorderColor = PrimaryContainer, cursorColor = Primary),
                                                    )
                                                    Text("-", color = PrimaryContainer, fontWeight = FontWeight.Bold, fontSize = 20.sp)
                                                    OutlinedTextField(
                                                        value = scoreTwo, onValueChange = { scoreTwo = it.filter { c -> c.isDigit() } },
                                                        modifier = Modifier.width(64.dp), singleLine = true, placeholder = { Text("0") },
                                                        colors = OutlinedTextFieldDefaults.colors(focusedTextColor = TextPrimary, unfocusedTextColor = TextPrimary, focusedBorderColor = Primary, unfocusedBorderColor = PrimaryContainer, cursorColor = Primary),
                                                    )
                                                    Button(
                                                        onClick = {
                                                            val s1 = scoreOne.toIntOrNull() ?: return@Button
                                                            val s2 = scoreTwo.toIntOrNull() ?: return@Button
                                                            viewModel.saveScore(eventId, pg.latestHistoryId, s1, s2)
                                                            editingScoreId = null
                                                        },
                                                        colors = ButtonDefaults.buttonColors(containerColor = Primary),
                                                    ) { Text("Save", color = OnPrimary, fontWeight = FontWeight.Bold) }
                                                }
                                            } else {
                                                Button(
                                                    onClick = { editingScoreId = pg.latestHistoryId; scoreOne = ""; scoreTwo = "" },
                                                    modifier = Modifier.fillMaxWidth(),
                                                    colors = ButtonDefaults.buttonColors(containerColor = Primary),
                                                ) { Text("\u270F\uFE0F  Record score", color = OnPrimary, fontWeight = FontWeight.Bold, fontSize = 15.sp) }
                                            }
                                        }

                                        if (pg.hasCost && !pg.allPaid) {
                                            Button(
                                                onClick = onPayments,
                                                modifier = Modifier.fillMaxWidth(),
                                                colors = ButtonDefaults.buttonColors(containerColor = Warning),
                                            ) { Text("\uD83D\uDCB0  Mark payments", color = Bg, fontWeight = FontWeight.Bold, fontSize = 15.sp) }
                                        }
                                    }
                                }
                            }
                        }

                        // Quick join
                        if (user?.name != null) {
                            Card(colors = CardDefaults.cardColors(containerColor = Surface), modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp)) {
                                if (myPlayer != null) {
                                    Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                                        Text(
                                            if (isOnBench) "You're on the bench" else "You joined as ${myPlayer.name}",
                                            color = if (isOnBench) Warning else Success, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f),
                                        )
                                        OutlinedButton(onClick = { viewModel.removePlayer(eventId, myPlayer.id) }, colors = ButtonDefaults.outlinedButtonColors(contentColor = Error)) {
                                            Text("Leave")
                                        }
                                    }
                                } else {
                                    Button(
                                        onClick = { viewModel.addPlayer(eventId, user!!.name, true) },
                                        modifier = Modifier.fillMaxWidth().padding(14.dp),
                                        colors = ButtonDefaults.buttonColors(containerColor = Primary),
                                    ) { Text("Join (${user!!.name})", color = OnPrimary, fontWeight = FontWeight.Bold) }
                                }
                            }
                        }

                        // Undo banner
                        state.undoData?.let { undo ->
                            Card(
                                colors = CardDefaults.cardColors(containerColor = SurfaceHover),
                                modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp).clickable { viewModel.undoRemove(eventId) },
                            ) {
                                Text("${undo.name} removed — tap to undo", color = Primary, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center, modifier = Modifier.padding(12.dp).fillMaxWidth())
                            }
                        }

                        // Teams
                        val teams = event.teamResults
                        if (teams != null && teams.size == 2) {
                            Card(colors = CardDefaults.cardColors(containerColor = Surface), modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp)) {
                                Row(Modifier.padding(14.dp)) {
                                    Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                                        Text(teams[0].name, color = Primary, fontWeight = FontWeight.Bold, fontSize = 13.sp)
                                        teams[0].members.forEach { Text(it.name, color = TextSecondary, fontSize = 13.sp) }
                                    }
                                    Text("VS", color = TextMuted, fontWeight = FontWeight.Bold, modifier = Modifier.padding(horizontal = 8.dp, vertical = 16.dp))
                                    Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                                        Text(teams[1].name, color = Primary, fontWeight = FontWeight.Bold, fontSize = 13.sp)
                                        teams[1].members.forEach { Text(it.name, color = TextSecondary, fontSize = 13.sp) }
                                    }
                                }
                            }
                        }

                        // Players
                        SectionTitle("Playing (${activePlayers.size}/${event.maxPlayers})")
                        activePlayers.forEach { p ->
                            PlayerRow(
                                player = p, isMe = p.userId == user?.id, canClaim = canClaim && p.userId == null,
                                onRemove = { viewModel.removePlayer(eventId, p.id) },
                                onClaim = { viewModel.claimPlayer(eventId, p.id) },
                                canRemove = isOwner || p.userId == user?.id || p.userId == null,
                            )
                        }

                        if (benchPlayers.isNotEmpty()) {
                            SectionTitle("Bench (${benchPlayers.size})")
                            benchPlayers.forEach { p ->
                                PlayerRow(player = p, isMe = p.userId == user?.id, isBench = true,
                                    onRemove = { viewModel.removePlayer(eventId, p.id) },
                                    canRemove = isOwner || p.userId == user?.id || p.userId == null)
                            }
                        }

                        // Suggestions
                        if (suggestions.isNotEmpty() && newPlayer.isBlank()) {
                            Row(modifier = Modifier.padding(top = 12.dp).horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                suggestions.forEach { s ->
                                    AssistChip(onClick = { viewModel.addPlayer(eventId, s.name) }, label = { Text("${s.name} (${s.gamesPlayed}g)") })
                                }
                            }
                        }

                        // Add player
                        Row(modifier = Modifier.padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                            OutlinedTextField(
                                value = newPlayer, onValueChange = { newPlayer = it },
                                placeholder = { Text("Add player name") }, singleLine = true,
                                modifier = Modifier.weight(1f),
                                colors = OutlinedTextFieldDefaults.colors(focusedTextColor = TextPrimary, unfocusedTextColor = TextPrimary, focusedBorderColor = Primary, unfocusedBorderColor = Border, cursorColor = Primary, focusedContainerColor = SurfaceHover, unfocusedContainerColor = SurfaceHover),
                            )
                            Button(
                                onClick = { viewModel.addPlayer(eventId, newPlayer.trim()); newPlayer = "" },
                                enabled = newPlayer.isNotBlank(),
                                colors = ButtonDefaults.buttonColors(containerColor = PrimaryDark),
                            ) { Text("Add", color = PrimaryContainer, fontWeight = FontWeight.Bold) }
                        }

                        // History
                        if (state.history.isNotEmpty()) {
                            Row(modifier = Modifier.fillMaxWidth().padding(top = 16.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                                SectionTitle("History")
                                TextButton(onClick = onLog) { Text("View log →", color = Primary, fontSize = 13.sp) }
                            }
                            state.history.forEach { h ->
                                HistoryCard(h, editingScoreId, scoreOne, scoreTwo,
                                    onEditScore = { editingScoreId = h.id; scoreOne = (h.scoreOne ?: "").toString(); scoreTwo = (h.scoreTwo ?: "").toString() },
                                    onScoreOneChange = { scoreOne = it }, onScoreTwoChange = { scoreTwo = it },
                                    onSaveScore = {
                                        val s1 = scoreOne.toIntOrNull() ?: return@HistoryCard
                                        val s2 = scoreTwo.toIntOrNull() ?: return@HistoryCard
                                        viewModel.saveScore(eventId, h.id, s1, s2); editingScoreId = null
                                    },
                                )
                            }
                        }
                        Spacer(Modifier.height(40.dp))
                    }
                }
            }
        }
    }
}

@Composable
fun SectionTitle(text: String) {
    Text(text, color = Primary, fontSize = 13.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp, modifier = Modifier.padding(top = 16.dp, bottom = 8.dp))
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PlayerRow(
    player: Player, isMe: Boolean = false, isBench: Boolean = false,
    canClaim: Boolean = false, canRemove: Boolean = false,
    onRemove: () -> Unit = {}, onClaim: () -> Unit = {},
) {
    Card(
        colors = CardDefaults.cardColors(containerColor = Surface),
        modifier = Modifier.fillMaxWidth().padding(bottom = 4.dp),
    ) {
        Row(Modifier.padding(horizontal = 14.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(
                "${player.name}${if (isMe) " ✓" else ""}",
                color = if (isBench) TextMuted else TextPrimary, fontSize = 14.sp,
                modifier = Modifier.weight(1f),
            )
            if (canClaim) {
                TextButton(onClick = onClaim) { Text("Claim", color = TextMuted, fontSize = 11.sp) }
            }
            if (canRemove) {
                IconButton(onClick = onRemove, modifier = Modifier.size(32.dp)) {
                    Icon(Icons.Default.Close, "Remove", tint = TextMuted, modifier = Modifier.size(16.dp))
                }
            }
        }
    }
}

@Composable
fun HistoryCard(
    h: GameHistory, editingScoreId: String?, scoreOne: String, scoreTwo: String,
    onEditScore: () -> Unit, onScoreOneChange: (String) -> Unit, onScoreTwoChange: (String) -> Unit,
    onSaveScore: () -> Unit,
) {
    Card(colors = CardDefaults.cardColors(containerColor = Surface), modifier = Modifier.fillMaxWidth().padding(bottom = 6.dp)) {
        Column(Modifier.padding(12.dp)) {
            Text(formatRelativeDate(h.dateTime), color = TextMuted, fontSize = 12.sp)
            if (h.scoreOne != null && h.scoreTwo != null) {
                Text("${h.teamOneName} ${h.scoreOne} - ${h.scoreTwo} ${h.teamTwoName}", color = TextPrimary, fontWeight = FontWeight.Bold, fontSize = 15.sp,
                    modifier = if (h.editable) Modifier.clickable(onClick = onEditScore) else Modifier)
            } else if (h.editable) {
                if (editingScoreId == h.id) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 4.dp)) {
                        OutlinedTextField(value = scoreOne, onValueChange = onScoreOneChange, modifier = Modifier.width(50.dp), singleLine = true)
                        Text("-", color = TextMuted, fontWeight = FontWeight.Bold)
                        OutlinedTextField(value = scoreTwo, onValueChange = onScoreTwoChange, modifier = Modifier.width(50.dp), singleLine = true)
                        Button(onClick = onSaveScore, colors = ButtonDefaults.buttonColors(containerColor = PrimaryDark)) { Text("Save", color = PrimaryContainer) }
                    }
                } else {
                    TextButton(onClick = onEditScore) { Text("+ Score", color = Primary, fontWeight = FontWeight.SemiBold) }
                }
            } else {
                Text(h.status, color = TextSecondary, fontSize = 13.sp)
            }
            h.eloUpdates?.takeIf { it.isNotEmpty() }?.let { updates ->
                Row(modifier = Modifier.padding(top = 6.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    updates.forEach { eu ->
                        Text("${eu.name} ${if (eu.delta > 0) "+" else ""}${eu.delta}",
                            color = if (eu.delta > 0) Success else if (eu.delta < 0) Error else TextMuted,
                            fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
                    }
                }
            }
        }
    }
}
