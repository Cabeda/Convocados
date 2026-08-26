package dev.convocados.ui.screen.rankings

import androidx.compose.foundation.clickable
import androidx.compose.foundation.background
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.HowToReg
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.*
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import dev.convocados.R
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import dev.convocados.data.api.ConvocadosApi
import dev.convocados.data.api.ApiException
import dev.convocados.data.api.EventDetail
import dev.convocados.data.api.Player
import dev.convocados.data.api.PlayerRating
import dev.convocados.data.api.UserProfile
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
    val initialRating: Int? = null,
    val mvpAwards: Int = 0,
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
    private val _hidden = MutableStateFlow(false)
    val hidden: StateFlow<Boolean> = _hidden
    private val _hasMore = MutableStateFlow(false)
    val hasMore: StateFlow<Boolean> = _hasMore
    private val _loadingMore = MutableStateFlow(false)
    val loadingMore: StateFlow<Boolean> = _loadingMore
    private val _canEdit = MutableStateFlow(false)
    val canEdit: StateFlow<Boolean> = _canEdit
    private val _canManage = MutableStateFlow(false)
    val canManage: StateFlow<Boolean> = _canManage
    private val _message = MutableStateFlow<String?>(null)
    val message: StateFlow<String?> = _message
    private var nextCursor: String? = null

    init {
        viewModelScope.launch { runCatching { _user.value = api.fetchUserInfo() } }
    }

    fun load(id: String) {
        viewModelScope.launch {
            _loading.value = true
            val evResult = runCatching { api.fetchEvent(id) }
            val ratResult = runCatching { api.fetchRatings(id) }
            evResult.onSuccess {
                _event.value = it
                val isOwner = _user.value?.id != null && it.ownerId == _user.value?.id
                val hasEditPermission = isOwner || it.isAdmin || it.ownerId == null
                _canEdit.value = hasEditPermission && it.allowManualRating
                _canManage.value = hasEditPermission
            }
            ratResult.onSuccess { page ->
                _hidden.value = false
                _ratings.value = page.data
                nextCursor = page.nextCursor
                _hasMore.value = page.hasMore
            }.onFailure { e ->
                if (e is ApiException && e.code == 403) _hidden.value = true
                else _message.value = e.message
            }
            _loading.value = false
            _refreshing.value = false
        }
    }

    fun refresh(id: String) {
        _refreshing.value = true
        load(id)
    }

    fun loadMore(id: String) {
        val cursor = nextCursor ?: return
        if (_loadingMore.value) return
        _loadingMore.value = true
        viewModelScope.launch {
            runCatching { api.fetchRatings(id, cursor) }
                .onSuccess { page ->
                    _ratings.value = _ratings.value + page.data
                    nextCursor = page.nextCursor
                    _hasMore.value = page.hasMore
                }
                .onFailure { _message.value = it.message }
            _loadingMore.value = false
        }
    }

    fun recalculate(id: String) {
        viewModelScope.launch {
            runCatching { api.recalculateRatings(id) }
                .onSuccess { load(id) }
                .onFailure { _message.value = it.message }
        }
    }

    fun setInitialRating(id: String, name: String, initialRating: Int) {
        viewModelScope.launch {
            runCatching { api.setInitialRating(id, name, initialRating) }
                .onSuccess { load(id) }
                .onFailure { _message.value = it.message }
        }
    }

    fun purgePlayer(id: String, name: String) {
        viewModelScope.launch {
            runCatching { api.purgePlayer(id, name) }
                .onSuccess { _ratings.value = _ratings.value.filter { it.name != name } }
                .onFailure { _message.value = it.message }
        }
    }

    fun claimPlayer(eventId: String, playerId: String) {
        viewModelScope.launch {
            runCatching { api.claimPlayer(eventId, playerId) }
                .onSuccess { load(eventId) }
        }
    }

    fun clearMessage() {
        _message.value = null
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
            initialRating = r.initialRating,
            mvpAwards = r.mvpAwards,
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
    onUserClick: (String) -> Unit = {},
    viewModel: RankingsViewModel = hiltViewModel(),
) {
    val ratings by viewModel.ratings.collectAsStateWithLifecycle()
    val event by viewModel.event.collectAsStateWithLifecycle()
    val loading by viewModel.loading.collectAsStateWithLifecycle()
    val refreshing by viewModel.refreshing.collectAsStateWithLifecycle()
    val user by viewModel.user.collectAsStateWithLifecycle()
    val hidden by viewModel.hidden.collectAsStateWithLifecycle()
    val hasMore by viewModel.hasMore.collectAsStateWithLifecycle()
    val loadingMore by viewModel.loadingMore.collectAsStateWithLifecycle()
    val canEdit by viewModel.canEdit.collectAsStateWithLifecycle()
    val canManage by viewModel.canManage.collectAsStateWithLifecycle()
    val message by viewModel.message.collectAsStateWithLifecycle()

    LaunchedEffect(eventId) { viewModel.load(eventId) }

    val players = event?.players ?: emptyList()
    val rows = mergeRows(ratings, players)
    val userHasLinkedPlayer = user != null && players.any { it.userId == user?.id }

    var claimTarget by remember { mutableStateOf<RankingRow?>(null) }
    var editTarget by remember { mutableStateOf<RankingRow?>(null) }
    var editValue by remember { mutableStateOf("") }
    var purgeTarget by remember { mutableStateOf<RankingRow?>(null) }

    val snackbarHostState = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val recalculatingMsg = stringResource(R.string.recalculating)

    LaunchedEffect(message) {
        val m = message ?: return@LaunchedEffect
        snackbarHostState.showSnackbar(m)
        viewModel.clearMessage()
    }

    val accent = MaterialTheme.colorScheme.primary

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = refreshing,
            onRefresh = { viewModel.refresh(eventId) },
            modifier = Modifier.fillMaxSize().padding(padding),
        ) {
            LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
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
                                if (canEdit) {
                                    IconButton(onClick = {
                                        viewModel.recalculate(eventId)
                                        scope.launch { snackbarHostState.showSnackbar(recalculatingMsg) }
                                    }) { Icon(Icons.Default.Refresh, stringResource(R.string.recalculate), tint = accent) }
                                }
                            }
                            Text(event?.title ?: stringResource(R.string.rankings), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.ExtraBold)
                            Text(stringResource(R.string.rankings), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }

                if (hidden) {
                    item { Card(Modifier.fillMaxWidth()) { Text(stringResource(R.string.ratings_hidden), color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(20.dp)) } }
                } else if (loading) {
                    item { Box(Modifier.fillMaxWidth().padding(48.dp), Alignment.Center) { CircularProgressIndicator(color = accent) } }
                } else if (rows.isEmpty()) {
                    item { Box(Modifier.fillMaxWidth().padding(48.dp), Alignment.Center) { Text(stringResource(R.string.no_ratings), color = MaterialTheme.colorScheme.outline) } }
                } else {
                    item { Card(Modifier.fillMaxWidth()) { Text(stringResource(R.string.elo_explainer), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(12.dp)) } }

                    itemsIndexed(rows, key = { _, r -> r.name }) { index, r ->
                        val canClaim = user != null && !userHasLinkedPlayer && r.userId == null && r.playerId != null
                        val podiumColor = if (index < 3 && r.rating != null) PodiumColors[index] else null

                        Card(
                            colors = CardDefaults.cardColors(containerColor = if (podiumColor != null) podiumColor.copy(alpha = 0.09f) else MaterialTheme.colorScheme.surface),
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                                RankBadge(index + 1, podiumColor)
                                Column(Modifier.weight(1f).padding(horizontal = 10.dp)) {
                                    Text(
                                        r.name + if (r.userId == user?.id) stringResource(R.string.you_suffix) else "",
                                        color = MaterialTheme.colorScheme.onSurface,
                                        style = MaterialTheme.typography.titleSmall,
                                        fontWeight = if (podiumColor != null) FontWeight.Bold else FontWeight.SemiBold,
                                        modifier = if (r.userId != null) Modifier.clickable { onUserClick(requireNotNull(r.userId)) } else Modifier,
                                    )
                                    if (r.rating != null) {
                                        Text("${r.gamesPlayed}g \u00B7 W${r.wins}/D${r.draws}/L${r.losses}", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                                    } else {
                                        Text(stringResource(R.string.new_player), color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                                    }
                                }
                                Column(horizontalAlignment = Alignment.End) {
                                    if (r.rating != null) {
                                        Text("${r.rating}", color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.ExtraBold)
                                        if (r.initialRating != null) Text(stringResource(R.string.initial_rating) + " ${r.initialRating}", color = MaterialTheme.colorScheme.outline, style = MaterialTheme.typography.labelSmall)
                                    } else {
                                        Text("\u2014", color = MaterialTheme.colorScheme.outline, style = MaterialTheme.typography.titleMedium)
                                    }
                                }
                                if (r.mvpAwards > 0) {
                                    Spacer(Modifier.width(8.dp))
                                    Text("\uD83C\uDFC6${r.mvpAwards}", color = MaterialTheme.colorScheme.tertiary, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold)
                                }
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    if (canClaim) IconButton(onClick = { claimTarget = r }, modifier = Modifier.size(40.dp)) { Icon(Icons.Default.HowToReg, stringResource(R.string.claim_as_me), tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(20.dp)) }
                                    if (canEdit && r.rating != null) IconButton(onClick = { editTarget = r; editValue = (r.initialRating ?: r.rating).toString() }, modifier = Modifier.size(40.dp)) { Icon(Icons.Default.Edit, stringResource(R.string.set_initial_rating), tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(18.dp)) }
                                    if (canManage) IconButton(onClick = { purgeTarget = r }, modifier = Modifier.size(40.dp)) { Icon(Icons.Default.Delete, stringResource(R.string.purge_player), tint = MaterialTheme.colorScheme.error, modifier = Modifier.size(18.dp)) }
                                }
                            }
                        }
                    }

                    if (hasMore) {
                        item {
                            OutlinedButton(onClick = { viewModel.loadMore(eventId) }, enabled = !loadingMore, modifier = Modifier.fillMaxWidth()) {
                                if (loadingMore) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp) else Text(stringResource(R.string.load_more))
                            }
                        }
                    }
                }
            }
        }
    }

    // Claim player confirmation dialog
    claimTarget?.let { target ->
        AlertDialog(
            onDismissRequest = { claimTarget = null },
            title = { Text(stringResource(R.string.claim_player), color = MaterialTheme.colorScheme.onSurface) },
            text = { Text(stringResource(R.string.claim_confirm, target.name), color = MaterialTheme.colorScheme.onSurfaceVariant) },
            confirmButton = {
                TextButton(onClick = { target.playerId?.let { viewModel.claimPlayer(eventId, it) }; claimTarget = null }) { Text(stringResource(R.string.claim), color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Bold) }
            },
            dismissButton = { TextButton(onClick = { claimTarget = null }) { Text(stringResource(R.string.cancel), color = MaterialTheme.colorScheme.outline) } },
            containerColor = MaterialTheme.colorScheme.surface,
        )
    }

    // Set initial rating dialog
    editTarget?.let { target ->
        AlertDialog(
            onDismissRequest = { editTarget = null },
            title = { Text(stringResource(R.string.set_initial_rating_confirm, target.name)) },
            text = {
                Column {
                    Text(stringResource(R.string.set_initial_rating), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(value = editValue, onValueChange = { editValue = it.filter { c -> c.isDigit() } }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.fillMaxWidth())
                }
            },
            confirmButton = { TextButton(onClick = { editValue.toIntOrNull()?.let { viewModel.setInitialRating(eventId, target.name, it) }; editTarget = null }) { Text(stringResource(R.string.save), color = MaterialTheme.colorScheme.primary) } },
            dismissButton = { TextButton(onClick = { editTarget = null }) { Text(stringResource(R.string.cancel), color = MaterialTheme.colorScheme.outline) } },
        )
    }

    // Purge player confirmation dialog
    purgeTarget?.let { target ->
        AlertDialog(
            onDismissRequest = { purgeTarget = null },
            title = { Text(stringResource(R.string.purge_player), color = MaterialTheme.colorScheme.error) },
            text = { Text(stringResource(R.string.purge_player_confirm, target.name), color = MaterialTheme.colorScheme.onSurfaceVariant) },
            confirmButton = { TextButton(onClick = { viewModel.purgePlayer(eventId, target.name); purgeTarget = null }) { Text(stringResource(R.string.remove), color = MaterialTheme.colorScheme.error, fontWeight = FontWeight.Bold) } },
            dismissButton = { TextButton(onClick = { purgeTarget = null }) { Text(stringResource(R.string.cancel), color = MaterialTheme.colorScheme.outline) } },
        )
    }
}

private val PodiumColors = listOf(Color(0xFFC9A227), Color(0xFF9EA7B3), Color(0xFFB08D57))

@Composable private fun RankBadge(rank: Int, color: Color?) {
    if (color != null) {
        Box(Modifier.size(30.dp).clip(CircleShape).background(color.copy(alpha = 0.25f)), Alignment.Center) {
            Text("$rank", fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurface)
        }
    } else {
        Text("$rank", color = MaterialTheme.colorScheme.outline, fontWeight = FontWeight.Bold, modifier = Modifier.width(24.dp))
    }
}
