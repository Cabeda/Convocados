package dev.convocados.ui.screen.event

import android.content.Intent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.compose.material.icons.filled.Contacts
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import dev.convocados.R
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import dev.convocados.data.api.*
import dev.convocados.data.auth.TokenStore
import dev.convocados.data.datastore.SettingsStore
import dev.convocados.data.repository.EventRepository
import dev.convocados.ui.screen.courts.PLAYTOMIC_SPORTS
import dev.convocados.ui.screen.games.formatRelativeDate
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
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.Shuffle
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.EmojiEvents
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Place
import androidx.compose.material.icons.filled.Balance

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
    val teamMoveUndo: TeamMoveUndo? = null,
    val isFollowing: Boolean = false,
    val mutePlayerActivity: Boolean? = null,
    val muteReminders: Boolean? = null,
    val mutePostGame: Boolean? = null,
    val muteEventDetails: Boolean? = null,
    val showNotificationSheet: Boolean = false,
    // Payment nudge
    val balance: BalanceResponse? = null,
    val paymentGateBlocked: Boolean = false,
    val showPaymentNudge: Boolean = false,
    // Contact-pick auto-add
    val addedPlayerName: String? = null,
)

data class TeamMoveUndo(
    val playerName: String,
    val previousTeamOneIds: List<String>,
    val previousTeamTwoIds: List<String>,
)

@OptIn(ExperimentalCoroutinesApi::class)
@HiltViewModel
class EventDetailViewModel @Inject constructor(
    private val repository: EventRepository,
    private val api: ConvocadosApi,
    private val tokenStore: TokenStore,
    private val client: ApiClient,
    private val settingsStore: SettingsStore,
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

    val autoPayOnJoin: StateFlow<Boolean> = settingsStore.autoPayOnJoin
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), false)

    fun setAutoPayOnJoin(enabled: Boolean) {
        viewModelScope.launch { settingsStore.setAutoPayOnJoin(enabled) }
    }

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
            val known = runCatching { api.fetchKnownPlayers(eventId) }.getOrNull()?.players ?: emptyList()
            val following = runCatching { api.getFollowState(eventId) }.getOrNull()
            val balance = runCatching { api.fetchBalance(eventId) }.getOrNull()
            _state.value = _state.value.copy(
                loading = false, refreshing = false, postGame = postGame, knownPlayers = known,
                isFollowing = following?.following ?: false,
                mutePlayerActivity = following?.mutePlayerActivity,
                muteReminders = following?.muteReminders,
                mutePostGame = following?.mutePostGame,
                muteEventDetails = following?.muteEventDetails,
                balance = balance,
            )
        }
    }

    fun toggleFollow(eventId: String) {
        if (_state.value.isFollowing) {
            // Already following — show notification preferences sheet
            _state.value = _state.value.copy(showNotificationSheet = true)
            return
        }
        viewModelScope.launch {
            _state.value = _state.value.copy(isFollowing = true)
            runCatching { api.followEvent(eventId) }
                .onFailure { _state.value = _state.value.copy(isFollowing = false) }
        }
    }

    fun dismissNotificationSheet() {
        _state.value = _state.value.copy(showNotificationSheet = false)
    }

    fun updateNotificationOverride(eventId: String, field: String, value: Boolean?) {
        viewModelScope.launch {
            val req = when (field) {
                "mutePlayerActivity" -> FollowOverridesRequest(mutePlayerActivity = value)
                "muteReminders" -> FollowOverridesRequest(muteReminders = value)
                "mutePostGame" -> FollowOverridesRequest(mutePostGame = value)
                "muteEventDetails" -> FollowOverridesRequest(muteEventDetails = value)
                else -> return@launch
            }
            runCatching { api.updateFollowPreferences(eventId, req) }
                .onSuccess { res ->
                    _state.value = _state.value.copy(
                        mutePlayerActivity = res.mutePlayerActivity,
                        muteReminders = res.muteReminders,
                        mutePostGame = res.mutePostGame,
                        muteEventDetails = res.muteEventDetails,
                    )
                }
        }
    }

    fun unfollow(eventId: String) {
        viewModelScope.launch {
            _state.value = _state.value.copy(isFollowing = false, showNotificationSheet = false)
            runCatching { api.unfollowEvent(eventId) }
                .onFailure { _state.value = _state.value.copy(isFollowing = true) }
        }
    }

    fun refresh(eventId: String) {
        _state.value = _state.value.copy(refreshing = true)
        load(eventId)
    }

    fun addPlayer(eventId: String, name: String, link: Boolean = true, email: String? = null) {
        viewModelScope.launch {
            repository.addPlayer(eventId, name, link, email)
                .onSuccess { resolvedName ->
                    _state.value = _state.value.copy(addedPlayerName = resolvedName ?: name)
                    // Auto-open payment dialog after join if preference is set
                    if (autoPayOnJoin.value && _state.value.balance?.callerBalance?.let { it.amount > 0 } == true) {
                        _state.value = _state.value.copy(showPaymentNudge = true)
                    }
                }
                .onFailure { e ->
                    if (e is ApiException && e.code == 402) {
                        // Parse the PAYMENT_GATE response
                        val gateError = runCatching {
                            kotlinx.serialization.json.Json { ignoreUnknownKeys = true }
                                .decodeFromString<PaymentGateError>(e.message ?: "")
                        }.getOrNull()
                        _state.value = _state.value.copy(
                            paymentGateBlocked = true,
                            balance = _state.value.balance?.copy(
                                callerBalance = gateError?.balance
                            ) ?: BalanceResponse(callerBalance = gateError?.balance),
                        )
                    } else {
                        _state.value = _state.value.copy(error = e.message)
                    }
                }
        }
    }

    fun dismissAddedPlayerSnackbar() {
        _state.value = _state.value.copy(addedPlayerName = null)
    }

    fun fetchBalance(eventId: String) {
        viewModelScope.launch {
            runCatching { api.fetchBalance(eventId) }
                .onSuccess { _state.value = _state.value.copy(balance = it) }
        }
    }

    /** Show payment nudge dialog before joining. */
    fun showPaymentNudge() {
        _state.value = _state.value.copy(showPaymentNudge = true)
    }

    fun dismissPaymentNudge() {
        _state.value = _state.value.copy(showPaymentNudge = false)
    }

    fun dismissPaymentGate() {
        _state.value = _state.value.copy(paymentGateBlocked = false)
    }

    /** Self-report as sent, then attempt to join. */
    fun markSentAndJoin(eventId: String, playerName: String) {
        viewModelScope.launch {
            _state.value = _state.value.copy(showPaymentNudge = false)
            runCatching { api.markPaymentSent(eventId, playerName) }
            // Now attempt to join (gate should clear since sent removes pending amount)
            repository.addPlayer(eventId, playerName, true)
                .onFailure { _state.value = _state.value.copy(error = it.message) }
        }
    }

    /** Join without paying (dismiss nudge). */
    fun joinWithoutPaying(eventId: String, name: String) {
        _state.value = _state.value.copy(showPaymentNudge = false)
        addPlayer(eventId, name, true)
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

    fun movePlayerToTeam(eventId: String, playerId: String, playerName: String, toTeamOne: Boolean) {
        val event = event.value ?: return
        val teams = event.teamResults ?: return
        if (teams.size != 2) return

        val oldTeamOneIds = teams[0].members.map { m -> event.players.find { it.name == m.name }?.id }.filterNotNull()
        val oldTeamTwoIds = teams[1].members.map { m -> event.players.find { it.name == m.name }?.id }.filterNotNull()

        val newTeamOneIds = if (toTeamOne) (oldTeamOneIds + playerId).distinct() else oldTeamOneIds.filter { it != playerId }
        val newTeamTwoIds = if (toTeamOne) oldTeamTwoIds.filter { it != playerId } else (oldTeamTwoIds + playerId).distinct()

        viewModelScope.launch {
            runCatching { api.updateTeams(eventId, newTeamOneIds, newTeamTwoIds) }
                .onSuccess {
                    _state.value = _state.value.copy(
                        teamMoveUndo = TeamMoveUndo(playerName, oldTeamOneIds, oldTeamTwoIds)
                    )
                    repository.refreshEventDetail(eventId)
                    delay(3000)
                    _state.value = _state.value.copy(teamMoveUndo = null)
                }
                .onFailure { e ->
                    val msg = parseApiErrorMessage(e) ?: "Failed to update teams"
                    _state.value = _state.value.copy(error = msg)
                }
        }
    }

    fun undoTeamMove(eventId: String) {
        val undo = _state.value.teamMoveUndo ?: return
        _state.value = _state.value.copy(teamMoveUndo = null)
        viewModelScope.launch {
            runCatching { api.updateTeams(eventId, undo.previousTeamOneIds, undo.previousTeamTwoIds) }
                .onSuccess { repository.refreshEventDetail(eventId) }
        }
    }

    fun claimPlayer(eventId: String, playerId: String) {
        viewModelScope.launch {
            runCatching { api.claimPlayer(eventId, playerId) }
                .onSuccess { repository.refreshEventDetail(eventId) }
        }
    }

    fun reorderPlayers(eventId: String, playerIds: List<String>) {
        viewModelScope.launch {
            runCatching { api.reorderPlayers(eventId, playerIds) }
                .onSuccess { repository.refreshEventDetail(eventId) }
        }
    }

    fun saveScore(eventId: String, historyId: String, s1: Int, s2: Int) {
        viewModelScope.launch {
            runCatching { api.updateScore(eventId, historyId, s1, s2) }
                .onSuccess { repository.refreshEventDetail(eventId) }
                .onFailure { e ->
                    val msg = parseApiErrorMessage(e) ?: "Failed to update score"
                    _state.value = _state.value.copy(error = msg)
                }
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

    suspend fun fetchCalendarIcs(eventId: String): String? =
        runCatching { client.fetchCalendarIcs(eventId) }.getOrNull()
}

private fun parseApiErrorMessage(e: Throwable): String? {
    val body = e.message ?: return null
    val match = Regex(""""error"\s*:\s*"([^"]+)"""").find(body)
    return match?.groupValues?.get(1)
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalSharedTransitionApi::class)
@Composable
fun EventDetailScreen(
    eventId: String,
    autoOpenPay: Boolean = false,
    onBack: () -> Unit,
    onSettings: () -> Unit,
    onRankings: () -> Unit,
    onPayments: () -> Unit,
    onLog: () -> Unit,
    onAttendance: () -> Unit,
    onNotificationPrefs: () -> Unit,
    onUserClick: (String) -> Unit,
    onHistoryClick: (String) -> Unit = {},
    onAllHistory: () -> Unit = {},
    onCourtAlternatives: () -> Unit = {},
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
    val snackbarHostState = remember { SnackbarHostState() }

    LaunchedEffect(state.teamMoveUndo) {
        val undo = state.teamMoveUndo ?: return@LaunchedEffect
        val result = snackbarHostState.showSnackbar(
            message = context.getString(R.string.player_moved, undo.playerName),
            actionLabel = context.getString(R.string.undo),
            duration = SnackbarDuration.Short,
        )
        if (result == SnackbarResult.ActionPerformed) {
            viewModel.undoTeamMove(eventId)
        }
    }

    LaunchedEffect(state.addedPlayerName) {
        val name = state.addedPlayerName ?: return@LaunchedEffect
        snackbarHostState.showSnackbar(
            message = context.getString(R.string.added_player_confirm, name),
            duration = SnackbarDuration.Short,
        )
        viewModel.dismissAddedPlayerSnackbar()
    }

    LaunchedEffect(eventId) { viewModel.load(eventId) }

    // Auto-open payment dialog from ?action=pay deep link
    LaunchedEffect(autoOpenPay, state.balance) {
        if (autoOpenPay && state.balance?.callerBalance != null && state.balance!!.callerBalance!!.amount > 0) {
            viewModel.showPaymentNudge()
        }
    }

    // Notification preferences bottom sheet
    if (state.showNotificationSheet) {
        ModalBottomSheet(onDismissRequest = { viewModel.dismissNotificationSheet() }) {
            Column(Modifier.padding(horizontal = 24.dp, vertical = 16.dp)) {
                Text(stringResource(R.string.notification_settings), style = MaterialTheme.typography.titleLarge)
                Spacer(Modifier.height(16.dp))
                NotificationToggleRow(stringResource(R.string.player_activity), state.mutePlayerActivity) { value ->
                    viewModel.updateNotificationOverride(eventId, "mutePlayerActivity", value)
                }
                NotificationToggleRow(stringResource(R.string.game_reminders), state.muteReminders) { value ->
                    viewModel.updateNotificationOverride(eventId, "muteReminders", value)
                }
                NotificationToggleRow(stringResource(R.string.post_game_results), state.mutePostGame) { value ->
                    viewModel.updateNotificationOverride(eventId, "mutePostGame", value)
                }
                NotificationToggleRow(stringResource(R.string.event_changes), state.muteEventDetails) { value ->
                    viewModel.updateNotificationOverride(eventId, "muteEventDetails", value)
                }
                Spacer(Modifier.height(24.dp))
                TextButton(
                    onClick = { viewModel.unfollow(eventId) },
                    colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error),
                    modifier = Modifier.fillMaxWidth(),
                ) { Text(stringResource(R.string.unfollow)) }
                Spacer(Modifier.height(16.dp))
            }
        }
    }

    val scrollBehavior = TopAppBarDefaults.enterAlwaysScrollBehavior()
    Scaffold(
        topBar = {
            TopAppBar(
                scrollBehavior = scrollBehavior,
                title = { Text(event?.title ?: stringResource(R.string.event_fallback), maxLines = 1) },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back)) } },
                actions = {
                    IconButton(onClick = { viewModel.toggleFollow(eventId) }) {
                        Icon(
                            if (state.isFollowing) Icons.Default.Notifications else Icons.Default.NotificationsNone,
                            contentDescription = if (state.isFollowing) stringResource(R.string.following) else stringResource(R.string.follow),
                            tint = if (state.isFollowing) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background),
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
        containerColor = MaterialTheme.colorScheme.background,
        modifier = with(sharedTransitionScope) {
            Modifier.sharedElement(
                rememberSharedContentState(key = "item-container-$eventId"),
                animatedVisibilityScope = animatedVisibilityScope
            )
        }.nestedScroll(scrollBehavior.nestedScrollConnection)
    ) { padding ->
        when {
            state.loading && event == null -> Box(Modifier.fillMaxSize().padding(padding), Alignment.Center) {
                CircularProgressIndicator(color = MaterialTheme.colorScheme.primary)
            }
            state.locked -> {
                Column(Modifier.fillMaxSize().padding(padding).padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                    Text(stringResource(R.string.password_protected), color = MaterialTheme.colorScheme.onSurface, fontWeight = FontWeight.Bold)
                    Spacer(Modifier.height(8.dp))
                    state.error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
                    OutlinedTextField(value = password, onValueChange = { password = it }, placeholder = { Text(stringResource(R.string.password)) }, singleLine = true, modifier = Modifier.fillMaxWidth().padding(top = 16.dp))
                    Button(onClick = { viewModel.verifyPassword(eventId, password.trim()) }, modifier = Modifier.fillMaxWidth().padding(top = 12.dp), colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primary)) {
                        Text(stringResource(R.string.unlock), color = MaterialTheme.colorScheme.onPrimary, fontWeight = FontWeight.Bold)
                    }
                }
            }
            state.error != null && state.event == null -> {
                Column(Modifier.fillMaxSize().padding(padding).padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                    Text(state.error ?: stringResource(R.string.event_not_found), color = MaterialTheme.colorScheme.error)
                    TextButton(onClick = onBack) { Text(stringResource(R.string.go_back), color = MaterialTheme.colorScheme.primary) }
                }
            }
            else -> {
                val event = state.event ?: return@Scaffold
                val activePlayers = event.players.take(event.maxPlayers)
                val benchPlayers = event.players.drop(event.maxPlayers)
                val isOwner = user?.id == event.ownerId
                val myPlayer = user?.let { u -> event.players.find { it.name.equals(u.name, true) } }
                val isOnBench = myPlayer != null && event.players.indexOf(myPlayer) >= event.maxPlayers
                val currentNames = event.players.map { it.name.lowercase() }.toSet()
                val suggestions = state.knownPlayers.filter { it.name.lowercase() !in currentNames }.take(5)

                PullToRefreshBox(
                    isRefreshing = state.refreshing,
                    onRefresh = { viewModel.refresh(eventId) },
                    modifier = Modifier.fillMaxSize().padding(padding),
                ) {
                    Column(modifier = Modifier.verticalScroll(rememberScrollState()).padding(16.dp)) {
                        // Header
                        EventHeader(
                            title = event.title,
                            dateLabel = formatRelativeDate(event.dateTime),
                            location = event.location,
                            modifier = Modifier.testTag("event_header"),
                        )

                        // Action bar
                        Row(modifier = Modifier.padding(vertical = 12.dp).horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            AssistChip(onClick = {
                                val url = viewModel.getShareUrl(eventId)
                                val spotsLeft = event.maxPlayers - event.players.size
                                val text = "\u26BD ${event.title}\n\uD83D\uDCC5 ${formatRelativeDate(event.dateTime)}" +
                                    (if (event.location.isNotBlank()) "\n\uD83D\uDCCD ${event.location}" else "") +
                                    "\n\uD83D\uDC65 ${if (spotsLeft > 0) "$spotsLeft spot(s) left" else "Full"}\n\n$url"
                                context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply { type = "text/plain"; putExtra(Intent.EXTRA_TEXT, text) }, context.getString(R.string.share)))
                            }, label = { Text(stringResource(R.string.share)) }, leadingIcon = { Icon(Icons.Default.Share, null, modifier = Modifier.size(18.dp)) })
                            if (activePlayers.size >= 2) AssistChip(onClick = { viewModel.randomize(eventId, event.balanced) }, label = { Text(stringResource(R.string.randomize)) }, leadingIcon = { Icon(Icons.Default.Shuffle, null, modifier = Modifier.size(18.dp)) })
                            if (isOwner || event.isAdmin) AssistChip(onClick = onSettings, label = { Text(stringResource(R.string.settings)) }, leadingIcon = { Icon(Icons.Default.Settings, null, modifier = Modifier.size(18.dp)) })
                            AssistChip(onClick = onRankings, label = { Text(stringResource(R.string.rankings)) }, leadingIcon = { Icon(Icons.Default.EmojiEvents, null, modifier = Modifier.size(18.dp)) })
                            if (event.sport in PLAYTOMIC_SPORTS) AssistChip(onClick = onCourtAlternatives, label = { Text(stringResource(R.string.courts)) }, leadingIcon = { Icon(Icons.Default.Place, null, modifier = Modifier.size(18.dp)) })
                            AssistChip(onClick = onNotificationPrefs, label = { Text(stringResource(R.string.alerts)) }, leadingIcon = { Icon(Icons.Default.Notifications, null, modifier = Modifier.size(18.dp)) })
                        }

                        // Post-game banner — prominent, right after action bar
                        state.postGame?.let { pg ->
                            if (pg.gameEnded || pg.hasPendingPastPayments) {
                                Card(
                                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer),
                                    modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp),
                                ) {
                                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                                        Text(stringResource(R.string.game_ended), color = MaterialTheme.colorScheme.onPrimaryContainer, fontWeight = FontWeight.ExtraBold, style = MaterialTheme.typography.titleMedium)

                                        if (!pg.hasScore && pg.latestHistoryId != null) {
                                            if (editingScoreId == pg.latestHistoryId) {
                                                // Inline score entry
                                                Text(stringResource(R.string.record_final_score), color = MaterialTheme.colorScheme.onPrimaryContainer, style = MaterialTheme.typography.bodySmall)
                                                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                                    OutlinedTextField(
                                                        value = scoreOne, onValueChange = { scoreOne = it.filter { c -> c.isDigit() } },
                                                        modifier = Modifier.width(64.dp), singleLine = true, placeholder = { Text("0") },
                                                        colors = OutlinedTextFieldDefaults.colors(focusedTextColor = MaterialTheme.colorScheme.onSurface, unfocusedTextColor = MaterialTheme.colorScheme.onSurface, focusedBorderColor = MaterialTheme.colorScheme.primary, unfocusedBorderColor = MaterialTheme.colorScheme.onPrimaryContainer, cursorColor = MaterialTheme.colorScheme.primary),
                                                    )
                                                    Text("-", color = MaterialTheme.colorScheme.onPrimaryContainer, style = MaterialTheme.typography.titleLarge)
                                                    OutlinedTextField(
                                                        value = scoreTwo, onValueChange = { scoreTwo = it.filter { c -> c.isDigit() } },
                                                        modifier = Modifier.width(64.dp), singleLine = true, placeholder = { Text("0") },
                                                        colors = OutlinedTextFieldDefaults.colors(focusedTextColor = MaterialTheme.colorScheme.onSurface, unfocusedTextColor = MaterialTheme.colorScheme.onSurface, focusedBorderColor = MaterialTheme.colorScheme.primary, unfocusedBorderColor = MaterialTheme.colorScheme.onPrimaryContainer, cursorColor = MaterialTheme.colorScheme.primary),
                                                    )
                                                    Button(
                                                        onClick = {
                                                            val s1 = scoreOne.toIntOrNull() ?: return@Button
                                                            val s2 = scoreTwo.toIntOrNull() ?: return@Button
                                                            viewModel.saveScore(eventId, pg.latestHistoryId, s1, s2)
                                                            editingScoreId = null
                                                        },
                                                        colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primary),
                                                    ) { Text(stringResource(R.string.save), color = MaterialTheme.colorScheme.onPrimary, fontWeight = FontWeight.Bold) }
                                                }
                                            } else {
                                                Button(
                                                    onClick = { editingScoreId = pg.latestHistoryId; scoreOne = ""; scoreTwo = "" },
                                                    modifier = Modifier.fillMaxWidth(),
                                                    colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primary),
                                                ) { Text(stringResource(R.string.record_score), color = MaterialTheme.colorScheme.onPrimary, style = MaterialTheme.typography.titleSmall) }
                                            }
                                        }

                                        if (pg.hasCost && !pg.allPaid) {
                                            Button(
                                                onClick = onPayments,
                                                modifier = Modifier.fillMaxWidth(),
                                                colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.tertiary),
                                            ) { Text(stringResource(R.string.mark_payments), color = MaterialTheme.colorScheme.background, style = MaterialTheme.typography.titleSmall) }
                                        }
                                    }
                                }
                            }
                        }

                        // Quick join
                        if (user?.name != null) {
                            val callerBalance = state.balance?.callerBalance
                            val hasDebt = callerBalance != null && callerBalance.amount > 0
                            val enforcement = state.balance?.enforcement ?: "off"
                            val aggregate = state.balance?.aggregate

                            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface), modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp)) {
                                Column(Modifier.padding(14.dp)) {
                                    // Social proof
                                    if (aggregate != null && aggregate.totalCount > 0) {
                                        Text(
                                            stringResource(R.string.paid_for_last_game, aggregate.paidCount, aggregate.totalCount),
                                            style = MaterialTheme.typography.bodySmall,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                            modifier = Modifier.padding(bottom = 8.dp),
                                        )
                                    }

                                    // Streak
                                    if (callerBalance != null && callerBalance.streak > 1) {
                                        Text(
                                            stringResource(R.string.paid_streak, callerBalance.streak),
                                            style = MaterialTheme.typography.bodySmall,
                                            color = MaterialTheme.colorScheme.primary,
                                            modifier = Modifier.padding(bottom = 8.dp),
                                        )
                                    }

                                    if (myPlayer != null) {
                                        Row(verticalAlignment = Alignment.CenterVertically) {
                                            Text(
                                                if (isOnBench) stringResource(R.string.on_bench) else stringResource(R.string.joined_as, myPlayer.name),
                                                color = if (isOnBench) MaterialTheme.colorScheme.tertiary else MaterialTheme.colorScheme.primary, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f),
                                            )
                                            OutlinedButton(onClick = { viewModel.removePlayer(eventId, myPlayer.id) }, colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error)) {
                                                Text(stringResource(R.string.leave))
                                            }
                                        }
                                    } else {
                                        // Debt warning
                                        if (hasDebt && enforcement != "off") {
                                            Text(
                                                stringResource(R.string.owe_amount, "%.2f".format(callerBalance!!.amount), callerBalance.gamesOwed),
                                                style = MaterialTheme.typography.bodySmall,
                                                color = MaterialTheme.colorScheme.error,
                                                modifier = Modifier.padding(bottom = 8.dp),
                                            )
                                        }

                                        // Gate blocked alert
                                        if (state.paymentGateBlocked) {
                                            Text(
                                                stringResource(R.string.settle_balance),
                                                color = MaterialTheme.colorScheme.error,
                                                fontWeight = FontWeight.SemiBold,
                                                modifier = Modifier.padding(bottom = 8.dp),
                                            )
                                        }

                                        Button(
                                            onClick = {
                                                if (hasDebt && enforcement != "off") {
                                                    viewModel.showPaymentNudge()
                                                } else {
                                                    viewModel.addPlayer(eventId, user!!.name, true)
                                                }
                                            },
                                            modifier = Modifier.fillMaxWidth(),
                                            colors = ButtonDefaults.buttonColors(
                                                containerColor = if (hasDebt && enforcement != "off")
                                                    MaterialTheme.colorScheme.tertiary
                                                else MaterialTheme.colorScheme.primary
                                            ),
                                            enabled = !state.paymentGateBlocked,
                                        ) {
                                            Text(
                                                if (hasDebt && enforcement != "off")
                                                    stringResource(R.string.pay_and_join, "%.2f".format(callerBalance!!.amount))
                                                else stringResource(R.string.join_as, user!!.name),
                                                color = MaterialTheme.colorScheme.onPrimary,
                                                fontWeight = FontWeight.Bold,
                                            )
                                        }
                                    }
                                }
                            }
                        }

                        // Undo banner
                        state.undoData?.let { undo ->
                            Card(
                                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
                                modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp).clickable { viewModel.undoRemove(eventId) },
                            ) {
                                Text(stringResource(R.string.removed_tap_undo, undo.name), color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center, modifier = Modifier.padding(12.dp).fillMaxWidth())
                            }
                        }

                        // Teams
                        val teams = event.teamResults
                        if (teams != null && teams.size == 2) {
                            TeamsCard(
                                teams = teams,
                                players = event.players,
                                onMovePlayer = { pid, name, toTeamOne -> viewModel.movePlayerToTeam(eventId, pid, name, toTeamOne) },
                            )
                        } else if (activePlayers.size >= 2) {
                            CreateTeamsCard(
                                onBalanced = { viewModel.randomize(eventId, balanced = true) },
                                onRandom = { viewModel.randomize(eventId, balanced = false) },
                            )
                        }

                        // Players
                        SectionTitle(stringResource(R.string.playing_count, activePlayers.size, event.maxPlayers))
                        PlayerListCard(
                            players = activePlayers,
                            currentUserId = user?.id,
                            isOwner = isOwner,
                            onRemove = { viewModel.removePlayer(eventId, it) },
                        )

                        if (benchPlayers.isNotEmpty()) {
                            SectionTitle(stringResource(R.string.bench_count, benchPlayers.size))
                            PlayerListCard(
                                players = benchPlayers,
                                currentUserId = user?.id,
                                isOwner = isOwner,
                                isBench = true,
                                onRemove = { viewModel.removePlayer(eventId, it) },
                            )
                        }

                        // Suggestions (quick-add chips when input is empty)
                        if (suggestions.isNotEmpty() && newPlayer.isBlank()) {
                            Row(modifier = Modifier.padding(top = 12.dp).horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                suggestions.forEach { s ->
                                    AssistChip(onClick = { viewModel.addPlayer(eventId, s.name) }, label = { Text("${s.name} (${s.gamesPlayed}g)") })
                                }
                            }
                        }

                        // Add player with autocomplete dropdown
                        Box(modifier = Modifier.padding(top = 12.dp)) {
                            // derivedStateOf so the filter only recomputes when the query or the
                            // known-player set actually changes, not on every recomposition.
                            val filteredSuggestions by remember(currentNames) {
                                derivedStateOf {
                                    if (newPlayer.length >= 2) {
                                        state.knownPlayers.filter {
                                            it.name.lowercase().contains(newPlayer.lowercase()) && it.name.lowercase() !in currentNames
                                        }.take(5)
                                    } else emptyList()
                                }
                            }

                            Column {
                                var pickedEmail by remember { mutableStateOf<String?>(null) }
                                // Pick a contact's email directly (ACTION_PICK on the Email table):
                                // the picker grants temporary access to the chosen row, so we read
                                // the name + email without the READ_CONTACTS permission.
                                val contactPicker = rememberLauncherForActivityResult(
                                    androidx.activity.result.contract.ActivityResultContracts.StartActivityForResult()
                                ) { result ->
                                    if (result.resultCode == android.app.Activity.RESULT_OK) {
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
                                                            // Auto-add immediately (zero taps)
                                                            viewModel.addPlayer(eventId, contactName, link = false, email = contactEmail)
                                                            newPlayer = ""
                                                        } else {
                                                            // No email — just prefill name
                                                            newPlayer = contactName
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                                    OutlinedTextField(
                                        value = newPlayer, onValueChange = { newPlayer = it },
                                        placeholder = { Text(stringResource(R.string.add_player_placeholder)) }, singleLine = true,
                                        modifier = Modifier.weight(1f),
                                        supportingText = pickedEmail?.let { { Text(stringResource(R.string.will_invite, it)) } },
                                        trailingIcon = {
                                            IconButton(onClick = {
                                                contactPicker.launch(
                                                    android.content.Intent(
                                                        android.content.Intent.ACTION_PICK,
                                                        android.provider.ContactsContract.CommonDataKinds.Email.CONTENT_URI,
                                                    )
                                                )
                                            }) {
                                                Icon(Icons.Default.Contacts, contentDescription = stringResource(R.string.add_from_contacts), tint = MaterialTheme.colorScheme.primary)
                                            }
                                        },
                                        colors = OutlinedTextFieldDefaults.colors(focusedTextColor = MaterialTheme.colorScheme.onSurface, unfocusedTextColor = MaterialTheme.colorScheme.onSurface, focusedBorderColor = MaterialTheme.colorScheme.primary, unfocusedBorderColor = MaterialTheme.colorScheme.outline, cursorColor = MaterialTheme.colorScheme.primary, focusedContainerColor = MaterialTheme.colorScheme.surfaceVariant, unfocusedContainerColor = MaterialTheme.colorScheme.surfaceVariant),
                                    )
                                    Button(
                                        onClick = {
                                            val em = pickedEmail
                                            if (em != null) viewModel.addPlayer(eventId, newPlayer.trim(), link = false, email = em)
                                            else viewModel.addPlayer(eventId, newPlayer.trim())
                                            newPlayer = ""; pickedEmail = null
                                        },
                                        enabled = newPlayer.isNotBlank(),
                                        colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primaryContainer),
                                    ) { Text(stringResource(R.string.add_button), color = MaterialTheme.colorScheme.onPrimaryContainer, fontWeight = FontWeight.Bold) }
                                }
                                // Autocomplete dropdown
                                if (filteredSuggestions.isNotEmpty()) {
                                    Card(
                                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
                                        modifier = Modifier.fillMaxWidth().padding(top = 4.dp),
                                    ) {
                                        Column {
                                            filteredSuggestions.forEach { s ->
                                                Text(
                                                    stringResource(R.string.player_games_count, s.name, s.gamesPlayed),
                                                    modifier = Modifier.fillMaxWidth().clickable { viewModel.addPlayer(eventId, s.name); newPlayer = "" }.padding(horizontal = 16.dp, vertical = 10.dp),
                                                    color = MaterialTheme.colorScheme.onSurface, style = MaterialTheme.typography.bodyMedium,
                                                )
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        // History
                        if (state.history.isNotEmpty()) {
                            Row(modifier = Modifier.fillMaxWidth().padding(top = 16.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                                SectionTitle(stringResource(R.string.history))
                                TextButton(onClick = onLog) { Text(stringResource(R.string.view_log), color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.bodySmall) }
                            }
                            state.history.take(2).forEach { h ->
                                HistoryCard(h, editingScoreId, scoreOne, scoreTwo,
                                    onClick = { onHistoryClick(h.id) },
                                    onEditScore = { editingScoreId = h.id; scoreOne = (h.scoreOne ?: "").toString(); scoreTwo = (h.scoreTwo ?: "").toString() },
                                    onScoreOneChange = { scoreOne = it }, onScoreTwoChange = { scoreTwo = it },
                                    onSaveScore = {
                                        val s1 = scoreOne.toIntOrNull() ?: return@HistoryCard
                                        val s2 = scoreTwo.toIntOrNull() ?: return@HistoryCard
                                        viewModel.saveScore(eventId, h.id, s1, s2); editingScoreId = null
                                    },
                                )
                            }
                            if (state.history.size > 2) {
                                TextButton(onClick = onAllHistory, modifier = Modifier.fillMaxWidth()) {
                                    Text(pluralStringResource(R.plurals.see_all_games, state.history.size, state.history.size), color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.SemiBold)
                                }
                            }
                        }
                        Spacer(Modifier.height(40.dp))
                    }
                }
            }
        }
    }

    // ── Payment Nudge Dialog ──────────────────────────────────────────────
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
                        Switch(
                            checked = autoPayPref,
                            onCheckedChange = { viewModel.setAutoPayOnJoin(it) },
                        )
                    }
                }
            },
            confirmButton = {
                Button(
                    onClick = { viewModel.markSentAndJoin(eventId, user!!.name) },
                    colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.tertiary),
                ) {
                    Text(
                        if (callerBalance != null) stringResource(R.string.pay_and_join, "%.2f".format(callerBalance.amount)) else stringResource(R.string.sent_confirmation),
                        color = MaterialTheme.colorScheme.onTertiary,
                    )
                }
            },
            dismissButton = {
                TextButton(onClick = { viewModel.joinWithoutPaying(eventId, user!!.name) }) {
                    Text(stringResource(R.string.join_pay_later), color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f))
                }
            },
        )
    }
}

@Composable
fun SectionTitle(text: String) {
    Text(text, color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.labelMedium, letterSpacing = 1.sp, modifier = Modifier.padding(top = 16.dp, bottom = 8.dp).semantics { heading() })
}

/** Stateless event header (title, date, location) with heading semantics. */
@Composable
fun EventHeader(title: String, dateLabel: String, location: String, modifier: Modifier = Modifier) {
    Column(modifier) {
        Text(title, color = MaterialTheme.colorScheme.onSurface, style = MaterialTheme.typography.titleLarge, modifier = Modifier.semantics { heading() })
        Text(dateLabel, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium)
        if (location.isNotBlank()) Text(location, color = MaterialTheme.colorScheme.outline, style = MaterialTheme.typography.bodySmall)
    }
}

/** Discoverable affordance to generate teams when none exist yet. */
@Composable
fun CreateTeamsCard(onBalanced: () -> Unit, onRandom: () -> Unit, modifier: Modifier = Modifier) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface), modifier = modifier.fillMaxWidth().padding(bottom = 12.dp)) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(stringResource(R.string.create_teams_title), style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurface, modifier = Modifier.semantics { heading() })
            Text(stringResource(R.string.create_teams_desc), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = onBalanced, modifier = Modifier.weight(1f), colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primary)) {
                    Icon(Icons.Default.Balance, null, modifier = Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text(stringResource(R.string.teams_balanced))
                }
                OutlinedButton(onClick = onRandom, modifier = Modifier.weight(1f)) {
                    Icon(Icons.Default.Shuffle, null, modifier = Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text(stringResource(R.string.teams_random))
                }
            }
        }
    }
}

/** Stateless two-team card. Tapping a member moves them to the other team. */
@Composable
fun TeamsCard(
    teams: List<TeamResult>,
    players: List<Player>,
    onMovePlayer: (playerId: String, name: String, toTeamOne: Boolean) -> Unit,
    modifier: Modifier = Modifier,
) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface), modifier = modifier.fillMaxWidth().padding(bottom = 12.dp)) {
        Row(Modifier.padding(14.dp)) {
            TeamColumn(teams[0], players, toTeamOne = false, onMovePlayer = onMovePlayer, modifier = Modifier.weight(1f))
            Text(stringResource(R.string.vs), color = MaterialTheme.colorScheme.outline, fontWeight = FontWeight.Bold, modifier = Modifier.padding(horizontal = 8.dp, vertical = 16.dp))
            TeamColumn(teams[1], players, toTeamOne = true, onMovePlayer = onMovePlayer, modifier = Modifier.weight(1f))
        }
    }
}

@Composable
private fun TeamColumn(
    team: TeamResult,
    players: List<Player>,
    toTeamOne: Boolean,
    onMovePlayer: (playerId: String, name: String, toTeamOne: Boolean) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier, horizontalAlignment = Alignment.CenterHorizontally) {
        Text(team.name, color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.labelMedium)
        team.members.forEach { m ->
            val pid = players.find { it.name == m.name }?.id
            Text(
                m.name,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodySmall,
                modifier = if (pid != null) Modifier.clickable { onMovePlayer(pid, m.name, toTeamOne) } else Modifier,
            )
        }
    }
}

/** Stateless card listing a set of players (active or bench) with dividers. */
@Composable
fun PlayerListCard(
    players: List<Player>,
    currentUserId: String?,
    isOwner: Boolean,
    onRemove: (playerId: String) -> Unit,
    modifier: Modifier = Modifier,
    isBench: Boolean = false,
) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface), modifier = modifier.fillMaxWidth()) {
        Column {
            players.forEachIndexed { i, p ->
                PlayerRow(
                    player = p,
                    isMe = p.userId == currentUserId,
                    isBench = isBench,
                    onRemove = { onRemove(p.id) },
                    canRemove = isOwner || p.userId == currentUserId || p.userId == null,
                )
                if (i < players.lastIndex) HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            }
        }
    }
}

@androidx.compose.ui.tooling.preview.Preview(showBackground = true)
@androidx.compose.ui.tooling.preview.Preview(showBackground = true, uiMode = android.content.res.Configuration.UI_MODE_NIGHT_YES)
@Composable
private fun EventHeaderPreview() {
    dev.convocados.ui.theme.ConvocadosTheme {
        androidx.compose.material3.Surface {
            EventHeader(
                title = "Tuesday 5-a-side",
                dateLabel = "Tomorrow, 19:00",
                location = "Riverside Astro, Pitch 2",
                modifier = Modifier.padding(16.dp),
            )
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PlayerRow(
    player: Player, isMe: Boolean = false, isBench: Boolean = false,
    canRemove: Boolean = false,
    onRemove: () -> Unit = {},
) {
    ListItem(
        headlineContent = {
            val youSuffix = stringResource(R.string.you_suffix)
            Text(
                "${player.name}${if (isMe) youSuffix else ""}",
                color = if (isBench) MaterialTheme.colorScheme.outline else MaterialTheme.colorScheme.onSurface,
                fontWeight = if (isMe) FontWeight.SemiBold else FontWeight.Normal,
                style = MaterialTheme.typography.bodyMedium,
            )
        },
        leadingContent = {
            if (player.userId != null) {
                Icon(Icons.Default.Person, stringResource(R.string.linked), tint = if (isMe) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(20.dp))
            } else {
                Spacer(Modifier.size(20.dp))
            }
        },
        trailingContent = if (canRemove) {{ IconButton(onClick = onRemove, modifier = Modifier.size(32.dp)) { Icon(Icons.Default.Close, stringResource(R.string.remove), tint = MaterialTheme.colorScheme.outline, modifier = Modifier.size(16.dp)) } }} else null,
        colors = ListItemDefaults.colors(containerColor = Color.Transparent),
        modifier = Modifier.height(44.dp),
    )
}

@Composable
fun HistoryCard(
    h: GameHistory, editingScoreId: String?, scoreOne: String, scoreTwo: String,
    onClick: () -> Unit = {},
    onEditScore: () -> Unit, onScoreOneChange: (String) -> Unit, onScoreTwoChange: (String) -> Unit,
    onSaveScore: () -> Unit,
) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface), modifier = Modifier.fillMaxWidth().padding(bottom = 6.dp).clickable(onClick = onClick)) {
        Column(Modifier.padding(12.dp)) {
            Text(formatRelativeDate(h.dateTime), color = MaterialTheme.colorScheme.outline, style = MaterialTheme.typography.bodySmall)
            if (h.scoreOne != null && h.scoreTwo != null) {
                Text("${h.teamOneName} ${h.scoreOne} - ${h.scoreTwo} ${h.teamTwoName}", color = MaterialTheme.colorScheme.onSurface, style = MaterialTheme.typography.titleSmall,
                    modifier = if (h.editable) Modifier.clickable(onClick = onEditScore) else Modifier)
            } else if (h.editable) {
                if (editingScoreId == h.id) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 4.dp)) {
                        OutlinedTextField(value = scoreOne, onValueChange = onScoreOneChange, modifier = Modifier.width(50.dp), singleLine = true)
                        Text("-", color = MaterialTheme.colorScheme.outline, fontWeight = FontWeight.Bold)
                        OutlinedTextField(value = scoreTwo, onValueChange = onScoreTwoChange, modifier = Modifier.width(50.dp), singleLine = true)
                        Button(onClick = onSaveScore, colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primaryContainer)) { Text(stringResource(R.string.save), color = MaterialTheme.colorScheme.onPrimaryContainer) }
                    }
                } else {
                    TextButton(onClick = onEditScore) { Text(stringResource(R.string.add_score), color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.SemiBold) }
                }
            } else {
                Text(h.status, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
            }
            h.eloUpdates?.takeIf { it.isNotEmpty() }?.let { updates ->
                Row(modifier = Modifier.padding(top = 6.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    updates.forEach { eu ->
                        Text("${eu.name} ${if (eu.delta > 0) "+" else ""}${eu.delta}",
                            color = if (eu.delta > 0) MaterialTheme.colorScheme.primary else if (eu.delta < 0) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.outline,
                            style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.SemiBold)
                    }
                }
            }
        }
    }
}

@Composable
private fun NotificationToggleRow(label: String, muted: Boolean?, onToggle: (Boolean?) -> Unit) {
    // muted=null means "use global default" (enabled), muted=true means suppressed
    val enabled = muted != true
    Row(
        Modifier.fillMaxWidth().padding(vertical = 4.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, style = MaterialTheme.typography.bodyLarge)
        Switch(checked = enabled, onCheckedChange = { checked -> onToggle(if (checked) null else true) })
    }
}
