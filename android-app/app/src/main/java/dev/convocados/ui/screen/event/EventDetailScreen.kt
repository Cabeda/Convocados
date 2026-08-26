package dev.convocados.ui.screen.event

import android.content.Intent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.compose.animation.AnimatedVisibilityScope
import androidx.compose.animation.ExperimentalSharedTransitionApi
import androidx.compose.animation.SharedTransitionScope
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material3.*
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import coil3.compose.SubcomposeAsyncImage
import dagger.hilt.android.lifecycle.HiltViewModel
import dev.convocados.R
import dev.convocados.data.api.*
import dev.convocados.data.auth.TokenStore
import dev.convocados.data.datastore.SettingsStore
import dev.convocados.data.repository.EventRepository
import dev.convocados.ui.components.InitialAvatar
import dev.convocados.ui.screen.courts.PLAYTOMIC_SPORTS
import dev.convocados.ui.screen.games.formatEventDateInTz
import dev.convocados.ui.screen.games.formatRelativeDate
import dev.convocados.ui.screen.games.sportEmoji
import java.time.Duration
import java.time.Instant
import javax.inject.Inject
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json

data class EventScreenState(
    val loading: Boolean = true,
    val refreshing: Boolean = false,
    val event: EventDetail? = null,
    val history: List<GameHistory> = emptyList(),
    val historyHasMore: Boolean = false,
    val historyCursor: String? = null,
    val knownPlayers: List<KnownPlayer> = emptyList(),
    val postGame: PostGameStatus? = null,
    // Local, editable copy of the PAST game's payment snapshot for the
    // post-game banner. Initialized from postGame.paymentsSnapshot; toggled
    // locally, then saved to the GameHistory entry. Null until status loads.
    val postGamePayments: List<PaymentSnapshotEntry>? = null,
    val postGamePaymentsDirty: Boolean = false,
    val postGameSaving: Boolean = false,
    val error: String? = null,
    val locked: Boolean = false,
    val undoData: UndoData? = null,
    val teamMoveUndo: TeamMoveUndo? = null,
    val isFollowing: Boolean = false,
    val isPlayer: Boolean = false,
    val isAdmin: Boolean = false,
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
    // ADR 0025: pending-invite resend (owner/admin) — inviteId in flight for the
    // button spinner; notice drives a snackbar (cooldownSeconds non-null = 429).
    val resendingInviteId: String? = null,
    val resendNotice: InviteResendNotice? = null,
    // ADR 0025: retracting a pending invite — inviteId in flight; removedInviteName
    // drives a snackbar.
    val retractingInviteId: String? = null,
    val removedInviteName: String? = null,
    // ADR 0025: an invite was created but the invitee has no notification channel —
    // surface the share sheet so the user can send the link directly.
    val pendingShareInvite: PendingShareInvite? = null,
    // ADR 0025: ranked co-play suggestions (owner/admin) — one-tap Invite
    val coPlaySuggestions: List<CoPlaySuggestion> = emptyList(),
    val mvp: MvpResponse? = null,
    val mvpLoading: Boolean = false,
    val cost: EventCost? = null,
    val coPlayers: List<CoPlayer> = emptyList(),
)

/** Result of a pending-invite resend, surfaced as a snackbar. */
data class InviteResendNotice(
    val playerName: String,
    val cooldownSeconds: Long? = null,
)

/** An invite that couldn't be delivered via email/push, so it must be shared. */
data class PendingShareInvite(
    val inviteUrl: String,
    val playerName: String,
)

data class TeamMoveUndo(
    val playerName: String,
    val previousTeamOneIds: List<String>,
    val previousTeamTwoIds: List<String>,
)

/** Where an add-player suggestion comes from — drives the transparent label. */
enum class SuggestionSource { EVENT, CO_PLAY }

/** Shared lenient parser for API error bodies (PAYMENT_GATE, invite cooldown). */
private val errorJson = Json { ignoreUnknownKeys = true }

/**
 * A merged add-player suggestion. [gamesPlayedHere] is the per-event history
 * count; [coPlayCount] is how often the viewer co-played with this person on
 * OTHER events. Either can be 0 — the UI surfaces whichever is non-zero so
 * the user knows why the name is being recommended.
 */
data class PlayerSuggestion(
    val name: String,
    val gamesPlayedHere: Int,
    val coPlayCount: Int,
    val userId: String?,
    val image: String?,
    val source: SuggestionSource,
)

/**
 * Merge this event's known players with the viewer's global co-play list.
 * Event history wins on name collision (case-insensitive) and absorbs the
 * co-play count. Roster names are excluded. Sorted by total relevance,
 * capped at 30.
 */
internal fun mergePlayerSuggestions(
    known: List<KnownPlayer>,
    coPlayers: List<CoPlayer>,
    currentNames: Set<String>,
): List<PlayerSuggestion> {
    val excluded = currentNames.map { it.lowercase() }.toSet()
    val byName = LinkedHashMap<String, PlayerSuggestion>()
    for (k in known) {
        val key = k.name.lowercase()
        if (key in excluded || key in byName) continue
        byName[key] = PlayerSuggestion(k.name, k.gamesPlayed, 0, null, null, SuggestionSource.EVENT)
    }
    for (c in coPlayers) {
        val key = c.name.lowercase()
        if (key in excluded) continue
        val existing = byName[key]
        if (existing != null) {
            // Same person in both lists — keep event count, absorb co-play count.
            byName[key] = existing.copy(coPlayCount = c.coPlayCount, userId = existing.userId ?: c.userId, image = existing.image ?: c.image)
        } else {
            byName[key] = PlayerSuggestion(c.name, 0, c.coPlayCount, c.userId, c.image, SuggestionSource.CO_PLAY)
        }
    }
    return byName.values
        .sortedByDescending { it.gamesPlayedHere + it.coPlayCount }
        .take(30)
}

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
            // ADR 0025: co-play suggestions are owner/admin-only (server-gated).
            val ev = event.value
            val isOwner = _user.value?.id != null && ev?.ownerId == _user.value?.id
            val coPlay = if (isOwner || following?.isAdmin == true)
                runCatching { api.fetchEventSuggestions(eventId) }.getOrNull()?.suggestions ?: emptyList()
            else emptyList()
            val cost = runCatching { api.fetchEventCost(eventId) }.getOrNull()
            val coPlayers = runCatching { api.fetchCoPlayers() }.getOrNull()?.players ?: emptyList()
            // Seed the editable past-game payment snapshot from the server, but
            // don't clobber unsaved local edits.
            val seededPayments = if (_state.value.postGamePaymentsDirty)
                _state.value.postGamePayments
            else postGame?.paymentsSnapshot
            _state.value = _state.value.copy(
                loading = false, refreshing = false, postGame = postGame, knownPlayers = known,
                postGamePayments = seededPayments,
                isFollowing = following?.following ?: false,
                isPlayer = following?.isPlayer ?: false,
                isAdmin = following?.isAdmin ?: false,
                mutePlayerActivity = following?.mutePlayerActivity,
                muteReminders = following?.muteReminders,
                mutePostGame = following?.mutePostGame,
                muteEventDetails = following?.muteEventDetails,
                balance = balance,
                coPlaySuggestions = coPlay,
                cost = cost,
                coPlayers = coPlayers,
            )
        }
    }

    fun toggleFollow(eventId: String) {
        if (_state.value.isFollowing) {
            // Unfollow — API will block if user is a player (409)
            viewModelScope.launch {
                _state.value = _state.value.copy(isFollowing = false)
                runCatching { api.unfollowEvent(eventId) }
                    .onSuccess { repository.refreshMyGames() }
                    .onFailure { _state.value = _state.value.copy(isFollowing = true) }
            }
            return
        }
        viewModelScope.launch {
            _state.value = _state.value.copy(isFollowing = true)
            runCatching { api.followEvent(eventId) }
                .onSuccess { repository.refreshMyGames() }
                .onFailure { _state.value = _state.value.copy(isFollowing = false) }
        }
    }

    fun dismissNotificationSheet() {
        _state.value = _state.value.copy(showNotificationSheet = false)
    }

    fun showNotifications() {
        _state.value = _state.value.copy(showNotificationSheet = true)
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
        // Generate a fresh UUID per add. Server replays the cached 2xx response
        // if the same key + same body is sent twice (e.g. on a network retry).
        val idempotencyKey = java.util.UUID.randomUUID().toString()
        viewModelScope.launch {
            repository.addPlayer(eventId, name, link, email, idempotencyKey)
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
                            errorJson
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

    fun dismissResendNotice() {
        _state.value = _state.value.copy(resendNotice = null)
    }

    /** ADR 0025: one-tap invite from a co-play suggestion chip. */
    fun inviteSuggestion(eventId: String, userId: String, playerName: String) {
        viewModelScope.launch {
            runCatching { api.sendInvite(eventId, userId) }
                .onSuccess { res ->
                    // Pending invite created server-side — drop the chip locally.
                    _state.value = _state.value.copy(
                        coPlaySuggestions = _state.value.coPlaySuggestions.filter { it.userId != userId },
                    )
                    // No email/push channel for this invitee → the server intends
                    // the inviter to share the link directly (WhatsApp, SMS, ...).
                    if (!res.channels.email && !res.channels.webPush && !res.channels.appPush && res.inviteUrl.isNotBlank()) {
                        _state.value = _state.value.copy(pendingShareInvite = PendingShareInvite(res.inviteUrl, playerName))
                    }
                }
                .onFailure { _state.value = _state.value.copy(error = it.message) }
        }
    }

    /**
     * Share-a-link flow (web parity, PR #833): create the invite token silently
     * (deliver:false — no email/push/in-app notification) and always hand the
     * URL to the share sheet so the inviter delivers it themselves.
     */
    fun shareInviteLink(eventId: String, userId: String, playerName: String) {
        viewModelScope.launch {
            runCatching { api.sendInvite(eventId, userId, deliver = false) }
                .onSuccess { res ->
                    _state.value = _state.value.copy(
                        coPlaySuggestions = _state.value.coPlaySuggestions.filter { it.userId != userId },
                    )
                    if (res.inviteUrl.isNotBlank()) {
                        _state.value = _state.value.copy(pendingShareInvite = PendingShareInvite(res.inviteUrl, playerName))
                    }
                }
                .onFailure { _state.value = _state.value.copy(error = it.message) }
        }
    }

    /** Guest link invite for an anonymous player (no account) — always silent. */
    fun shareGuestLink(eventId: String, playerName: String) {
        viewModelScope.launch {
            runCatching { api.sendGuestInvite(eventId, playerName) }
                .onSuccess { res ->
                    if (res.inviteUrl.isNotBlank()) {
                        _state.value = _state.value.copy(pendingShareInvite = PendingShareInvite(res.inviteUrl, playerName))
                    }
                }
                .onFailure { _state.value = _state.value.copy(error = it.message) }
        }
    }

    fun dismissShareInvite() {
        _state.value = _state.value.copy(pendingShareInvite = null)
    }

    /** ADR 0025: retract (remove) a pending invite. */
    fun retractInvite(eventId: String, inviteId: String, playerName: String) {
        viewModelScope.launch {
            _state.value = _state.value.copy(retractingInviteId = inviteId)
            runCatching { api.retractInvite(eventId, inviteId) }
                .onSuccess {
                    _state.value = _state.value.copy(removedInviteName = playerName)
                    // Refresh so the removed invite disappears immediately (same
                    // pattern as undoRemove/removePlayer).
                    repository.refreshEventDetail(eventId)
                }
                .onFailure { _state.value = _state.value.copy(error = it.message) }
            _state.value = _state.value.copy(retractingInviteId = null)
        }
    }

    fun dismissRemovedInviteName() {
        _state.value = _state.value.copy(removedInviteName = null)
    }

    fun dismissError() {
        _state.value = _state.value.copy(error = null)
    }

    /** ADR 0025: resend a pending invite (24h cooldown enforced server-side). */
    fun resendInvite(eventId: String, inviteId: String, playerName: String) {
        viewModelScope.launch {
            _state.value = _state.value.copy(resendingInviteId = inviteId)
            runCatching { api.resendInvite(eventId, inviteId) }
                .onSuccess {
                    _state.value = _state.value.copy(resendNotice = InviteResendNotice(playerName))
                    load(eventId)
                }
                .onFailure { e ->
                    val retryAfter = if (e is ApiException && e.code == 429) {
                        runCatching {
                            errorJson
                                .decodeFromString<InviteResendErrorBody>(e.message ?: "")
                        }.getOrNull()?.retryAfterSeconds
                    } else null
                    if (retryAfter != null) {
                        _state.value = _state.value.copy(resendNotice = InviteResendNotice(playerName, retryAfter))
                    } else {
                        _state.value = _state.value.copy(error = e.message)
                    }
                }
            _state.value = _state.value.copy(resendingInviteId = null)
        }
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
                .onSuccess {
                    repository.refreshEventDetail(eventId)
                    // Refresh post-game status so banner hides when allComplete
                    val pg = runCatching { api.fetchPostGameStatus(eventId) }.getOrNull()
                    _state.value = _state.value.copy(postGame = pg)
                }
                .onFailure { e ->
                    val msg = parseApiErrorMessage(e) ?: "Failed to update score"
                    _state.value = _state.value.copy(error = msg)
                }
        }
    }

    /** Cycle a past-game player's payment status (pending <-> paid) locally. */
    fun togglePostGamePayment(playerName: String) {
        val current = _state.value.postGamePayments ?: return
        val updated = current.map {
            if (it.playerName == playerName)
                it.copy(status = if (it.status == "paid") "pending" else "paid")
            else it
        }
        _state.value = _state.value.copy(postGamePayments = updated, postGamePaymentsDirty = true)
    }

    /**
     * Persist the edited past-game payment snapshot to the GameHistory entry.
     * Mirrors the web PostGameBanner save (PATCH .../history/{id} with
     * paymentsSnapshot). Settled-game participants and admins may edit.
     */
    fun loadMvp(eventId: String, historyId: String) {
        _state.value = _state.value.copy(mvpLoading = true)
        viewModelScope.launch {
            runCatching { api.fetchMvp(eventId, historyId) }
                .onSuccess { resp -> _state.value = _state.value.copy(mvp = resp, mvpLoading = false) }
                .onFailure { _state.value = _state.value.copy(mvpLoading = false) }
        }
    }

    fun voteMvp(eventId: String, historyId: String, playerId: String) {
        _state.value = _state.value.copy(mvpLoading = true)
        viewModelScope.launch {
            runCatching { api.castMvpVote(eventId, historyId, playerId) }
                .onSuccess {
                    val resp = runCatching { api.fetchMvp(eventId, historyId) }.getOrNull()
                    if (resp != null) _state.value = _state.value.copy(mvp = resp, mvpLoading = false) else _state.value = _state.value.copy(mvpLoading = false)
                    val pg = runCatching { api.fetchPostGameStatus(eventId) }.getOrNull()
                    if (pg != null) _state.value = _state.value.copy(
                        postGame = pg,
                        postGamePayments = if (_state.value.postGamePaymentsDirty) _state.value.postGamePayments else pg.paymentsSnapshot,
                    )
                }
                .onFailure { e -> _state.value = _state.value.copy(mvpLoading = false, error = parseApiErrorMessage(e) ?: "Failed to vote") }
        }
    }

    fun savePostGamePayments(eventId: String) {
        val historyId = _state.value.postGame?.latestHistoryId ?: return
        val payments = _state.value.postGamePayments ?: return
        _state.value = _state.value.copy(postGameSaving = true)
        viewModelScope.launch {
            runCatching { api.updateHistoryPayments(eventId, historyId, payments) }
                .onSuccess {
                    _state.value = _state.value.copy(postGamePaymentsDirty = false, postGameSaving = false)
                    // Refresh status so allComplete / hide logic re-evaluates.
                    val pg = runCatching { api.fetchPostGameStatus(eventId) }.getOrNull()
                    _state.value = _state.value.copy(
                        postGame = pg,
                        postGamePayments = pg?.paymentsSnapshot ?: payments,
                    )
                }
                .onFailure { e ->
                    val msg = parseApiErrorMessage(e) ?: "Failed to save payments"
                    _state.value = _state.value.copy(postGameSaving = false, error = msg)
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

/**
 * Top-level so the type can be referenced both at the call site of
 * `mutableStateOf` and from the AlertDialog body (forward references
 * inside a composable are not always resolved by the Kotlin compiler).
 */
internal data class PendingAdd(val name: String, val email: String? = null, val userId: String? = null)


// ── Phase helpers (parity with web countdownUrgency) ───────────────────────

internal enum class EventPhase { NORMAL, SOON, URGENT, LIVE, PAST }

internal data class PhaseUi(
    val phase: EventPhase,
    val timeLine: String,
    val secondary: String?,
)

internal fun parseInstant(iso: String): Instant? = runCatching { Instant.parse(iso) }.getOrNull()

/** Server-side resend cooldown (24h) — mirrors invite.server.ts RESEND_COOLDOWN_MS. */
internal val RESEND_COOLDOWN: Duration = Duration.ofHours(24)

/** Remaining cooldown before an invite can be resent, or null when eligible. */
internal fun resendCooldownRemaining(notifiedAt: String?): Duration? {
    if (notifiedAt.isNullOrBlank()) return null
    val sentAt = parseInstant(notifiedAt) ?: return null
    val ends = sentAt.plus(RESEND_COOLDOWN)
    val now = Instant.now()
    return if (now.isBefore(ends)) Duration.between(now, ends) else null
}

/** Compact cooldown label, e.g. "1h 5m" / "42m". */
internal fun formatCooldownRemaining(remaining: Duration): String {
    val mins = remaining.toMinutes().coerceAtLeast(1)
    return if (mins >= 60) "${mins / 60}h ${mins % 60}m" else "${mins}m"
}

internal fun countdownText(remaining: Duration): String {
    val d = remaining.toDays()
    val h = remaining.toHours() % 24
    val m = remaining.toMinutes() % 60
    val s = remaining.seconds % 60
    return when {
        d > 0 -> "${d}d ${h}h ${m}m"
        h > 0 -> "%dh %02dm %02ds".format(h, m, s)
        else -> "%02dm %02ds".format(m, s)
    }
}

internal fun computePhaseUi(event: EventDetail, now: Instant): PhaseUi {
    val start = parseInstant(event.dateTime) ?: return PhaseUi(EventPhase.NORMAL, event.dateTime, null)
    val end = start.plus(Duration.ofMinutes(event.durationMinutes.toLong()))
    val phase = when {
        now >= end -> EventPhase.PAST
        now >= start -> EventPhase.LIVE
        now >= start.minus(Duration.ofHours(2)) -> EventPhase.URGENT
        now >= start.minus(Duration.ofHours(24)) -> EventPhase.SOON
        else -> EventPhase.NORMAL
    }
    return when (phase) {
        EventPhase.NORMAL -> PhaseUi(phase, formatEventDateInTz(event.dateTime, event.timezone), event.recurrenceRule)
        EventPhase.SOON, EventPhase.URGENT -> PhaseUi(phase, countdownText(Duration.between(now, start)), formatEventDateInTz(event.dateTime, event.timezone))
        EventPhase.LIVE -> PhaseUi(EventPhase.LIVE, "Live now", null)
        EventPhase.PAST -> if (event.isRecurring && event.nextResetAt != null && parseInstant(event.nextResetAt)?.let { it > now } == true)
            PhaseUi(phase, "Next game: ${formatEventDateInTz(event.nextResetAt, event.timezone)}", event.recurrenceRule)
        else PhaseUi(phase, "Ended", null)
    }
}

@Composable
internal fun rememberPhaseUi(event: EventDetail): PhaseUi {
    val initial = remember(event.dateTime, event.durationMinutes) {
        runCatching { computePhaseUi(event, Instant.now()) }.getOrElse { PhaseUi(EventPhase.NORMAL, event.dateTime, null) }
    }
    return produceState(initial, event) {
        while (true) {
            value = runCatching { computePhaseUi(event, Instant.now()) }.getOrDefault(value)
            delay(1000)
        }
    }.value
}

@Composable
internal fun phaseColors(phase: EventPhase): Pair<Color, Color> {
    val dark = isSystemInDarkTheme()
    val soonColor = if (dark) Color(0xFFFFC94D) else Color(0xFF9A6700)
    val base = MaterialTheme.colorScheme.surface
    val accent = when (phase) {
        EventPhase.NORMAL -> MaterialTheme.colorScheme.primary
        EventPhase.SOON -> soonColor
        EventPhase.URGENT -> MaterialTheme.colorScheme.error
        EventPhase.LIVE -> MaterialTheme.colorScheme.primary
        EventPhase.PAST -> MaterialTheme.colorScheme.outline
    }
    val bgAlpha = when (phase) {
        EventPhase.NORMAL -> 0.08f
        EventPhase.SOON, EventPhase.URGENT, EventPhase.LIVE -> 0.12f
        EventPhase.PAST -> 0.06f
    }
    return accent to lerp(base, accent, bgAlpha)
}

internal fun activePlayersOf(e: EventDetail) = e.players.take(e.maxPlayers)
internal fun benchPlayersOf(e: EventDetail) = e.players.drop(e.maxPlayers)
internal fun spotsLabelOf(e: EventDetail): String {
    val left = e.maxPlayers - e.players.size
    return when {
        left <= 0 -> "Full"
        left == 1 -> "1 spot left"
        else -> "$left spots left"
    }
}

// ── HERO Event Detail Screen ────────────────────────────────────────────

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
    val user by viewModel.user.collectAsStateWithLifecycle()
    val context = LocalContext.current
    var newPlayer by remember { mutableStateOf("") }
    var editingScoreId by remember { mutableStateOf<String?>(null) }
    var scoreOne by remember { mutableStateOf("") }
    var scoreTwo by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var pendingAdd by remember { mutableStateOf<PendingAdd?>(null) }
    var resendTarget by remember { mutableStateOf<RosterPlayer?>(null) }
    var retractTarget by remember { mutableStateOf<RosterPlayer?>(null) }
    var declinedOpen by remember { mutableStateOf(false) }
    val snackbarHostState = remember { SnackbarHostState() }

    LaunchedEffect(state.teamMoveUndo) {
        val undo = state.teamMoveUndo ?: return@LaunchedEffect
        val result = snackbarHostState.showSnackbar(
            message = context.getString(R.string.player_moved, undo.playerName),
            actionLabel = context.getString(R.string.undo),
            duration = SnackbarDuration.Short,
        )
        if (result == SnackbarResult.ActionPerformed) viewModel.undoTeamMove(eventId)
    }
    LaunchedEffect(state.addedPlayerName) {
        val name = state.addedPlayerName ?: return@LaunchedEffect
        snackbarHostState.showSnackbar(message = context.getString(R.string.added_player_confirm, name), duration = SnackbarDuration.Short)
        viewModel.dismissAddedPlayerSnackbar()
    }
    LaunchedEffect(state.resendNotice) {
        val notice = state.resendNotice ?: return@LaunchedEffect
        val msg = if (notice.cooldownSeconds != null) {
            val mins = (notice.cooldownSeconds / 60).coerceAtLeast(1)
            val time = if (mins >= 60) "${mins / 60}h ${mins % 60}m" else "${mins}m"
            context.getString(R.string.invite_resend_cooldown, time)
        } else {
            context.getString(R.string.invite_resent, notice.playerName)
        }
        snackbarHostState.showSnackbar(message = msg, duration = SnackbarDuration.Short)
        viewModel.dismissResendNotice()
    }
    LaunchedEffect(state.removedInviteName) {
        val name = state.removedInviteName ?: return@LaunchedEffect
        snackbarHostState.showSnackbar(message = context.getString(R.string.invite_removed, name), duration = SnackbarDuration.Short)
        viewModel.dismissRemovedInviteName()
    }
    LaunchedEffect(state.error) {
        val err = state.error ?: return@LaunchedEffect
        // Only surface transient mutation errors here; the empty/not-found and
        // locked screens render state.error as inline text instead.
        if (state.event != null) {
            snackbarHostState.showSnackbar(message = err, duration = SnackbarDuration.Short)
            viewModel.dismissError()
        }
    }
    LaunchedEffect(eventId) { viewModel.load(eventId) }
    LaunchedEffect(autoOpenPay, state.balance) {
        val caller = state.balance?.callerBalance
        if (autoOpenPay && caller != null && caller.amount > 0) viewModel.showPaymentNudge()
    }
    // Notification sheet
    if (state.showNotificationSheet) {
        ModalBottomSheet(onDismissRequest = { viewModel.dismissNotificationSheet() }) {
            Column(Modifier.padding(horizontal = 24.dp, vertical = 16.dp)) {
                Text(stringResource(R.string.notification_settings), style = MaterialTheme.typography.titleLarge)
                Spacer(Modifier.height(16.dp))
                NotificationToggleRow(stringResource(R.string.player_activity), state.mutePlayerActivity) { v -> viewModel.updateNotificationOverride(eventId, "mutePlayerActivity", v) }
                NotificationToggleRow(stringResource(R.string.game_reminders), state.muteReminders) { v -> viewModel.updateNotificationOverride(eventId, "muteReminders", v) }
                NotificationToggleRow(stringResource(R.string.post_game_results), state.mutePostGame) { v -> viewModel.updateNotificationOverride(eventId, "mutePostGame", v) }
                NotificationToggleRow(stringResource(R.string.event_changes), state.muteEventDetails) { v -> viewModel.updateNotificationOverride(eventId, "muteEventDetails", v) }
                if (state.isAdmin) {
                    Spacer(Modifier.height(16.dp)); HorizontalDivider(); Spacer(Modifier.height(12.dp))
                    Text(stringResource(R.string.notify_admin_section_title), style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.primary)
                    Spacer(Modifier.height(4.dp))
                    Text(stringResource(R.string.notify_admin_section_desc), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Spacer(Modifier.height(24.dp))
                if (!state.isPlayer) {
                    TextButton(onClick = { viewModel.unfollow(eventId) }, colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error), modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.unfollow)) }
                }
                Spacer(Modifier.height(16.dp))
            }
        }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        containerColor = MaterialTheme.colorScheme.background,
        modifier = with(sharedTransitionScope) {
            Modifier.sharedElement(rememberSharedContentState(key = "item-container-$eventId"), animatedVisibilityScope = animatedVisibilityScope)
        }
    ) { padding ->
        when {
            state.loading && event == null -> Box(Modifier.fillMaxSize().padding(padding), Alignment.Center) { CircularProgressIndicator() }
            state.locked -> {
                Column(Modifier.fillMaxSize().padding(padding).padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                    Text(stringResource(R.string.password_protected), fontWeight = FontWeight.Bold)
                    Spacer(Modifier.height(8.dp))
                    state.error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
                    OutlinedTextField(value = password, onValueChange = { password = it }, placeholder = { Text(stringResource(R.string.password)) }, singleLine = true, modifier = Modifier.fillMaxWidth().padding(top = 16.dp))
                    Button(onClick = { viewModel.verifyPassword(eventId, password.trim()) }, modifier = Modifier.fillMaxWidth().padding(top = 12.dp)) { Text(stringResource(R.string.unlock), fontWeight = FontWeight.Bold) }
                }
            }
            state.error != null && state.event == null -> {
                Column(Modifier.fillMaxSize().padding(padding).padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                    Text(state.error ?: stringResource(R.string.event_not_found), color = MaterialTheme.colorScheme.error)
                    TextButton(onClick = onBack) { Text(stringResource(R.string.go_back)) }
                }
            }
            else -> {
                val isDemo = dev.convocados.BuildConfig.DEBUG && state.event == null
                val demoState = remember { demoStateForHero() }
                val ds = if (isDemo) demoState else state
                val effectiveUser = if (isDemo) UserProfile(id = "u_demo", name = "João", email = "joao@example.com") else user
                val ev = ds.event ?: return@Scaffold
                val phaseUi = rememberPhaseUi(ev)
                val (accent, bg) = phaseColors(phaseUi.phase)
                val active = activePlayersOf(ev)
                val bench = benchPlayersOf(ev)
                val isOwner = effectiveUser?.id == ev.ownerId && ev.ownerId != null
                val myPlayer = effectiveUser?.let { u -> ev.players.find { it.name.equals(u.name, true) } }
                val isOnBench = myPlayer != null && ev.players.indexOf(myPlayer) >= ev.maxPlayers
                val currentNames = ev.players.map { it.name.lowercase() }.toSet()
                val fillFraction = if (ev.maxPlayers > 0) active.size.toFloat() / ev.maxPlayers else 0f

                PullToRefreshBox(isRefreshing = ds.refreshing, onRefresh = { viewModel.refresh(eventId) }, modifier = Modifier.fillMaxSize().padding(padding)) {
                    Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp)) {
                        // ── HERO ───────────────────────────────────────────────
                        Box(
                            Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Brush.verticalGradient(listOf(bg, MaterialTheme.colorScheme.surface))).padding(16.dp)
                        ) {
                            Column {
                                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                                    IconButton(onClick = onBack, modifier = Modifier.size(36.dp)) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back)) }
                                    Spacer(Modifier.weight(1f))
                                    if (!ds.isPlayer) {
                                        IconButton(onClick = { viewModel.toggleFollow(eventId) }) {
                                            Icon(
                                                if (ds.isFollowing) Icons.Default.Bookmark else Icons.Default.BookmarkBorder,
                                                contentDescription = if (ds.isFollowing) stringResource(R.string.following) else stringResource(R.string.follow),
                                                tint = if (ds.isFollowing) accent else MaterialTheme.colorScheme.onSurfaceVariant,
                                            )
                                        }
                                    }
                                    if (ds.isFollowing) {
                                        IconButton(onClick = { viewModel.showNotifications() }) { Icon(Icons.Default.Notifications, stringResource(R.string.notification_settings)) }
                                    }
                                    HeroMoreMenu(ev, ds, viewModel, eventId, onBack, onSettings, onRankings, onPayments, onLog, onAttendance, onNotificationPrefs, onAllHistory, onCourtAlternatives)
                                }
                                Text(sportEmoji(ev.sport), fontSize = 36.sp, modifier = Modifier.padding(top = 4.dp))
                                Text(ev.title, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.ExtraBold, modifier = Modifier.semantics { heading() })
                                ev.ownerName?.let { owner ->
                                    Row(
                                        verticalAlignment = Alignment.CenterVertically,
                                        modifier = Modifier.padding(top = 4.dp).let {
                                            if (ev.ownerId != null) it.clickable { onUserClick(requireNotNull(ev.ownerId)) } else it
                                        }
                                    ) {
                                        Icon(Icons.Default.Person, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(16.dp))
                                        Spacer(Modifier.width(6.dp))
                                        Text("Hosted by $owner", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.primary)
                                    }
                                }
                                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 12.dp)) {
                                    if (phaseUi.phase == EventPhase.LIVE) PulsingDot(accent) else Icon(Icons.Default.Schedule, null, tint = accent, modifier = Modifier.size(28.dp))
                                    Spacer(Modifier.width(10.dp))
                                    Column {
                                        Text(phaseUi.timeLine, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold, color = accent)
                                        phaseUi.secondary?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                                    }
                                }
                                if (ev.location.isNotBlank()) {
                                    Surface(shape = RoundedCornerShape(50), color = MaterialTheme.colorScheme.surface.copy(alpha = 0.85f), modifier = Modifier.padding(top = 12.dp).clickable {
                                        runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, android.net.Uri.parse("geo:0,0?q=${android.net.Uri.encode(ev.location)}"))) }
                                    }) {
                                        Row(Modifier.padding(horizontal = 12.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                                            Icon(Icons.Default.Place, null, tint = accent, modifier = Modifier.size(16.dp)); Spacer(Modifier.width(6.dp)); Text(ev.location, style = MaterialTheme.typography.bodyMedium)
                                        }
                                    }
                                }
                                ds.cost?.let { cost ->
                                    if (cost.totalAmount > 0) {
                                        val perPlayer = if (ev.maxPlayers > 0) cost.totalAmount / ev.maxPlayers else 0.0
                                        Row(
                                            verticalAlignment = Alignment.CenterVertically,
                                            modifier = Modifier.padding(top = 10.dp).clip(RoundedCornerShape(50)).background(MaterialTheme.colorScheme.surface.copy(alpha = 0.85f)).padding(horizontal = 12.dp, vertical = 6.dp)
                                        ) {
                                            Icon(Icons.Default.Payments, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(16.dp))
                                            Spacer(Modifier.width(6.dp))
                                            Text(
                                                "${cost.currency} ${"%.2f".format(cost.totalAmount)} total · ${"%.2f".format(perPlayer)} / player",
                                                style = MaterialTheme.typography.bodyMedium,
                                                fontWeight = FontWeight.SemiBold
                                            )
                                        }
                                    }
                                }
                                Column(Modifier.padding(top = 14.dp)) {
                                    LinearProgressIndicator(progress = { fillFraction }, modifier = Modifier.fillMaxWidth().height(6.dp).clip(RoundedCornerShape(3.dp)), color = when {
                                        fillFraction >= 1f -> MaterialTheme.colorScheme.error
                                        fillFraction >= 0.75f -> Color(0xFFB26A00)
                                        else -> MaterialTheme.colorScheme.primary
                                    }, trackColor = MaterialTheme.colorScheme.surfaceVariant)
                                    Text("${spotsLabelOf(ev)} \u00b7 ${active.size}/${ev.maxPlayers} playing", style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 6.dp))
                                }
                            }
                        }

                        Column(Modifier.padding(top = 12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            ds.undoData?.let { undo ->
                                Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant), modifier = Modifier.fillMaxWidth().clickable { viewModel.undoRemove(eventId) }) {
                                    Text(stringResource(R.string.removed_tap_undo, undo.name), color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center, modifier = Modifier.padding(12.dp).fillMaxWidth())
                                }
                            }
                            // Wrap-up
                            HeroWrapUp(eventId, ds, viewModel, effectiveUser, editingScoreId, scoreOne, scoreTwo,
                                onEditScore = { id, s1, s2 -> editingScoreId = id; scoreOne = s1; scoreTwo = s2 },
                                onScoreChange = { a, b -> scoreOne = a; scoreTwo = b },
                                onSaveScore = { editingScoreId = null },
                                onVoteMvp = { onHistoryClick(it) })
                            // Join / Leave (YOUR RESPONSE deprecated in favor of this)
                            if (effectiveUser?.name != null) {
                                val callerBalance = ds.balance?.callerBalance
                                val hasDebt = callerBalance != null && callerBalance.amount > 0
                                val enforcement = ds.balance?.enforcement ?: "off"
                                if (myPlayer == null) {
                                    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer)) {
                                        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                            if (hasDebt && enforcement != "off") Text(stringResource(R.string.owe_amount, "%.2f".format(callerBalance.amount), callerBalance.gamesOwed), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.SemiBold)
                                            val userName = effectiveUser.name
                                            Button(onClick = { if (hasDebt && enforcement != "off") viewModel.showPaymentNudge() else viewModel.addPlayer(eventId, userName, true) }, enabled = !ds.paymentGateBlocked, modifier = Modifier.fillMaxWidth(), colors = ButtonDefaults.buttonColors(containerColor = if (hasDebt && enforcement != "off") MaterialTheme.colorScheme.tertiary else MaterialTheme.colorScheme.primary)) {
                                                Text(if (hasDebt && enforcement != "off") stringResource(R.string.pay_and_join, "%.2f".format(callerBalance.amount)) else stringResource(R.string.join_as, userName), fontWeight = FontWeight.Bold)
                                            }
                                        }
                                    }
                                } else {
                                    Card {
                                        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                                            Text(if (isOnBench) stringResource(R.string.on_bench) else stringResource(R.string.joined_as, myPlayer.name), color = if (isOnBench) MaterialTheme.colorScheme.tertiary else MaterialTheme.colorScheme.primary, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                                            OutlinedButton(onClick = { viewModel.removePlayer(eventId, myPlayer.id) }, colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error)) { Text(stringResource(R.string.leave)) }
                                        }
                                    }
                                }
                            }
                            // Teams
                            val teams = ev.teamResults
                            if (teams != null && teams.size == 2) {
                                Card(Modifier.fillMaxWidth()) {
                                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                                        Text("Teams", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, modifier = Modifier.semantics { heading() })
                                        Row(verticalAlignment = Alignment.CenterVertically) {
                                            HeroTeamColumn(teams[0], ev, false, viewModel, eventId, Modifier.weight(1f), MaterialTheme.colorScheme.primary)
                                            VsBadge()
                                            HeroTeamColumn(teams[1], ev, true, viewModel, eventId, Modifier.weight(1f), MaterialTheme.colorScheme.secondary)
                                        }
                                    }
                                }
                            } else if (active.size >= 2) {
                                Card(Modifier.fillMaxWidth()) {
                                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                        Text(stringResource(R.string.create_teams_title), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                                        Text(stringResource(R.string.create_teams_desc), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                            Button(onClick = { viewModel.randomize(eventId, true) }, modifier = Modifier.weight(1f)) { Icon(Icons.Default.Balance, null, Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text(stringResource(R.string.teams_balanced)) }
                                            OutlinedButton(onClick = { viewModel.randomize(eventId, false) }, modifier = Modifier.weight(1f)) { Icon(Icons.Default.Shuffle, null, Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text(stringResource(R.string.teams_random)) }
                                        }
                                    }
                                }
                            }
                            // Roster
                            Card(Modifier.fillMaxWidth()) {
                                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Text("Players", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f).semantics { heading() })
                                        if (active.size >= 2) AssistChip(onClick = { viewModel.randomize(eventId, ev.balanced) }, label = { Text(stringResource(R.string.randomize)) }, leadingIcon = { Icon(Icons.Default.Shuffle, null, Modifier.size(16.dp)) })
                                    }
                                    // Add player first — the primary action, then the roster below it.
                                    AddPlayerHeroSection(eventId, ds, viewModel, currentNames, pendingAddSetter = { pendingAdd = it })
                                    HorizontalDivider()
                                    PlayerGroup(active, user, isOwner, false, viewModel, eventId, onUserClick)
                                    if (bench.isNotEmpty()) { HorizontalDivider(); Text(stringResource(R.string.bench_count, bench.size), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.tertiary, fontWeight = FontWeight.Bold); PlayerGroup(bench, user, isOwner, true, viewModel, eventId, onUserClick) }
                                    if (ev.invited.isNotEmpty()) {
                                        HorizontalDivider()
                                        Text(stringResource(R.string.invited_count, ev.invited.size), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Bold)
                                        ev.invited.forEach { inv ->
                                            val inviteActionId = inv.inviteId ?: inv.id
                                            InvitedRow(
                                                player = inv,
                                                resending = state.resendingInviteId == inviteActionId,
                                                removing = state.retractingInviteId == inviteActionId,
                                                onResend = { resendTarget = inv },
                                                onRemove = { retractTarget = inv },
                                            )
                                        }
                                    }
                                    if (ev.declined.isNotEmpty()) {
                                        TextButton(onClick = { declinedOpen = !declinedOpen }) { Text(if (declinedOpen) "Hide declined" else stringResource(R.string.declined_count, ev.declined.size), style = MaterialTheme.typography.labelMedium) }
                                        if (declinedOpen) ev.declined.forEach { Text("\u00b7 ${it.name}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline) }
                                    }
                                }
                            }
                            // History
                            if (ds.history.isNotEmpty()) {
                                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                                    Text("History", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, modifier = Modifier.semantics { heading() })
                                    TextButton(onClick = onLog) { Text(stringResource(R.string.view_log), style = MaterialTheme.typography.bodySmall) }
                                }
                                ds.history.take(2).forEach { h ->
                                    Card(Modifier.fillMaxWidth().clickable { onHistoryClick(h.id) }) {
                                        Column(Modifier.padding(12.dp)) {
                                            Text(formatEventDateInTz(h.dateTime, ev.timezone), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
                                            if (h.scoreOne != null && h.scoreTwo != null) Text("${h.teamOneName} ${h.scoreOne} \u2013 ${h.scoreTwo} ${h.teamTwoName}", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                                            h.eloUpdates?.takeIf { it.isNotEmpty() }?.let { ups ->
                                                Row(Modifier.padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                                    ups.forEach { eu -> Text("${eu.name} ${if (eu.delta > 0) "+" else ""}${eu.delta}", style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.SemiBold, color = if (eu.delta > 0) MaterialTheme.colorScheme.primary else if (eu.delta < 0) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.outline) }
                                                }
                                            }
                                        }
                                    }
                                }
                                if (ds.history.size > 2) TextButton(onClick = onAllHistory, modifier = Modifier.fillMaxWidth()) { Text("See all games", color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.SemiBold) }
                            }
                            Spacer(Modifier.height(40.dp))
                        }
                    }
                }
                // Add-player confirm — Invite or Add for registered users (web parity),
                // plain Add for anonymous/new names. Uses the display event `ev` so the
                // demo event shows its own title/list instead of "joins null".
                pendingAdd?.let { pending ->
                    val isBench = ev.players.size >= ev.maxPlayers
                    val isRegistered = pending.userId != null
                    AlertDialog(
                        onDismissRequest = { pendingAdd = null },
                        title = { Text(if (isRegistered) "Add or invite ${pending.name}?" else "Add ${pending.name}?") },
                        text = {
                            Column {
                                Text(when {
                                    pending.email != null && isBench -> "${pending.name} will be invited by email (${pending.email}) and placed on the bench."
                                    pending.email != null -> "${pending.name} will be invited by email (${pending.email})."
                                    isBench -> "${pending.name} joins ${ev.title} \u2014 the list is full, so they go to the bench."
                                    else -> "${pending.name} joins ${ev.title}."
                                })
                                // Web parity (PR #833): silent link-only invite handed
                                // straight to the share sheet — nothing sent to the invitee.
                                // Available for guests too: their only invite path.
                                if (isRegistered) {
                                    Spacer(Modifier.height(8.dp))
                                    TextButton(
                                        onClick = {
                                            viewModel.shareInviteLink(eventId, requireNotNull(pending.userId), pending.name)
                                            pendingAdd = null
                                        },
                                        modifier = Modifier.fillMaxWidth(),
                                    ) { Text(stringResource(R.string.invite_share_link), color = MaterialTheme.colorScheme.primary) }
                                } else {
                                    Spacer(Modifier.height(8.dp))
                                    TextButton(
                                        onClick = {
                                            viewModel.shareGuestLink(eventId, pending.name)
                                            pendingAdd = null
                                        },
                                        modifier = Modifier.fillMaxWidth(),
                                    ) { Text(stringResource(R.string.invite_share_link), color = MaterialTheme.colorScheme.primary) }
                                }
                            }
                        },
                        confirmButton = {
                            if (isRegistered) TextButton(onClick = { viewModel.inviteSuggestion(eventId, requireNotNull(pending.userId), pending.name); pendingAdd = null }) { Text(stringResource(R.string.invite)) }
                            else TextButton(onClick = { viewModel.addPlayer(eventId, pending.name, link = false, email = pending.email); pendingAdd = null }) { Text(stringResource(R.string.add_button)) }
                        },
                        dismissButton = {
                            if (isRegistered) TextButton(onClick = { viewModel.addPlayer(eventId, pending.name, link = false, email = pending.email); pendingAdd = null }) { Text(stringResource(R.string.add_to_list)) }
                            else TextButton(onClick = { pendingAdd = null }) { Text(stringResource(R.string.cancel)) }
                        },
                    )
                }
            }
        }
    }
    // Invited-row action: confirm the resend, or share the invite link directly
    // through Android's share sheet (contacts / messaging apps).
    resendTarget?.let { target ->
        val actionId = target.inviteId ?: target.id
        AlertDialog(
            onDismissRequest = { resendTarget = null },
            title = { Text(stringResource(R.string.invite_resend_confirm_title, target.name)) },
            text = {
                Column {
                    Text(stringResource(R.string.invite_resend_confirm_body))
                    val labels = channelLabels(target.channels)
                    if (labels != null) { Spacer(Modifier.height(8.dp)); Text(labels, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    target.inviteUrl?.takeIf { it.isNotBlank() }?.let { url ->
                        Spacer(Modifier.height(16.dp))
                        TextButton(
                            onClick = {
                                val send = Intent(Intent.ACTION_SEND).apply {
                                    type = "text/plain"
                                    putExtra(Intent.EXTRA_TEXT, url)
                                }
                                context.startActivity(Intent.createChooser(send, context.getString(R.string.invite_share_chose)))
                                resendTarget = null
                            },
                            modifier = Modifier.align(Alignment.CenterHorizontally),
                        ) { Text(stringResource(R.string.invite_share_link), color = MaterialTheme.colorScheme.primary) }
                    }
                }
            },
            confirmButton = { TextButton(onClick = { viewModel.resendInvite(eventId, actionId, target.name); resendTarget = null }) { Text(stringResource(R.string.invite_resend_confirm)) } },
            dismissButton = { TextButton(onClick = { resendTarget = null }) { Text(stringResource(R.string.cancel)) } },
        )
    }
    // Invited-row remove: confirm before retracting the pending invite.
    retractTarget?.let { target ->
        val actionId = target.inviteId ?: target.id
        AlertDialog(
            onDismissRequest = { retractTarget = null },
            title = { Text(stringResource(R.string.invite_retract_confirm_title, target.name)) },
            text = { Text(stringResource(R.string.invite_retract_confirm_body)) },
            confirmButton = { TextButton(onClick = { viewModel.retractInvite(eventId, actionId, target.name); retractTarget = null }) { Text(stringResource(R.string.invite_retract_confirm)) } },
            dismissButton = { TextButton(onClick = { retractTarget = null }) { Text(stringResource(R.string.cancel)) } },
        )
    }
    if (state.showPaymentNudge && user?.name != null) {
        val callerBalance = state.balance?.callerBalance
        val autoPayPref by viewModel.autoPayOnJoin.collectAsStateWithLifecycle()
        AlertDialog(onDismissRequest = { viewModel.dismissPaymentNudge() }, title = { Text(stringResource(R.string.settle_up_title)) }, text = {
            Column {
                if (callerBalance != null) Text(stringResource(R.string.owe_amount, "%.2f".format(callerBalance.amount), callerBalance.gamesOwed))
                state.balance?.aggregate?.let { agg -> if (agg.totalCount > 0) { Spacer(Modifier.height(8.dp)); Text(stringResource(R.string.paid_for_last_game, agg.paidCount, agg.totalCount), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) } }
                Spacer(Modifier.height(16.dp))
                Row(verticalAlignment = Alignment.CenterVertically) { Text(stringResource(R.string.always_show_payment), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f)); Switch(checked = autoPayPref, onCheckedChange = { viewModel.setAutoPayOnJoin(it) }) }
            }
        }, confirmButton = { val userName = user?.name ?: ""; Button(onClick = { viewModel.markSentAndJoin(eventId, userName) }, colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.tertiary)) { Text(if (callerBalance != null) stringResource(R.string.pay_and_join, "%.2f".format(callerBalance.amount)) else stringResource(R.string.sent_confirmation)) } }, dismissButton = { TextButton(onClick = { viewModel.joinWithoutPaying(eventId, user?.name ?: "") }) { Text(stringResource(R.string.join_pay_later)) } })
    }
}

@Composable
private fun PulsingDot(color: Color) {
    val t = rememberInfiniteTransition(label = "pulse")
    val a by t.animateFloat(initialValue = 1f, targetValue = 0.2f, animationSpec = infiniteRepeatable(tween(750), androidx.compose.animation.core.RepeatMode.Reverse), label = "pulseA")
    Box(Modifier.size(14.dp).alpha(a).background(color, CircleShape))
}

@Composable
private fun HeroTeamColumn(team: TeamResult, event: EventDetail, toTeamOne: Boolean, viewModel: EventDetailViewModel, eventId: String, modifier: Modifier = Modifier, headerColor: Color) {
    Column(
        modifier.clip(RoundedCornerShape(16.dp)).background(headerColor.copy(alpha = 0.08f)).padding(12.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        // Team header: accent bar + name + member count.
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Box(Modifier.size(width = 32.dp, height = 4.dp).clip(RoundedCornerShape(2.dp)).background(headerColor))
            Spacer(Modifier.height(6.dp))
            Text(team.name, color = headerColor, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.ExtraBold, textAlign = TextAlign.Center)
            Text("${team.members.size}", color = MaterialTheme.colorScheme.outline, style = MaterialTheme.typography.labelMedium)
        }
        // Player chips — tap to move to the other team. The arrow shows the
        // direction of the move, making the action obvious without hint text.
        team.members.forEach { m ->
            val pid = event.players.find { it.name == m.name }?.id
            val tappable = pid != null
            Row(
                Modifier.fillMaxWidth()
                    .clip(RoundedCornerShape(10.dp))
                    .background(headerColor.copy(alpha = if (tappable) 0.14f else 0.04f))
                    .then(if (tappable) Modifier.clickable { viewModel.movePlayerToTeam(eventId, pid, m.name, toTeamOne) } else Modifier)
                    .padding(horizontal = 10.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.Center,
            ) {
                Text(m.name, style = MaterialTheme.typography.bodyMedium, fontWeight = if (tappable) FontWeight.SemiBold else FontWeight.Normal, color = MaterialTheme.colorScheme.onSurface, textAlign = TextAlign.Center, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                if (tappable) {
                    Spacer(Modifier.width(4.dp))
                    Icon(
                        if (toTeamOne) Icons.AutoMirrored.Filled.ArrowBack else Icons.AutoMirrored.Filled.ArrowForward,
                        contentDescription = "Move ${m.name} to the other team",
                        tint = headerColor,
                        modifier = Modifier.size(16.dp),
                    )
                }
            }
        }
    }
}

@Composable private fun VsBadge() {
    Box(
        Modifier.padding(horizontal = 8.dp).size(36.dp).clip(CircleShape).background(MaterialTheme.colorScheme.surfaceVariant).border(1.dp, MaterialTheme.colorScheme.outlineVariant, CircleShape),
        Alignment.Center,
    ) {
        Text("VS", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.ExtraBold)
    }
}

@Composable
private fun PlayerGroup(players: List<Player>, user: UserProfile?, isOwner: Boolean, isBench: Boolean, viewModel: EventDetailViewModel, eventId: String, onUserClick: (String) -> Unit) {
    players.forEachIndexed { i, p ->
        PlayerRow(player = p, isMe = p.userId != null && p.userId == user?.id, isBench = isBench, canRemove = isOwner || p.userId == user?.id || p.userId == null, onRemove = { viewModel.removePlayer(eventId, p.id) }, onUserClick = p.userId?.let { { onUserClick(it) } } ?: {})
        if (i < players.lastIndex) HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
    }
}

@Composable
private fun HeroMoreMenu(ev: EventDetail, state: EventScreenState, viewModel: EventDetailViewModel, eventId: String, onBack: () -> Unit, onSettings: () -> Unit, onRankings: () -> Unit, onPayments: () -> Unit, onLog: () -> Unit, onAttendance: () -> Unit, onNotificationPrefs: () -> Unit, onAllHistory: () -> Unit, onCourtAlternatives: () -> Unit) {
    var open by remember { mutableStateOf(false) }
    val context = LocalContext.current
    Box {
        IconButton(onClick = { open = true }) { Icon(Icons.Default.MoreVert, "More actions") }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            DropdownMenuItem(text = { Text(stringResource(R.string.share)) }, onClick = {
                open = false
                val url = viewModel.getShareUrl(eventId)
                val spots = ev.maxPlayers - ev.players.size
                val text = "${sportEmoji(ev.sport)} ${ev.title}\n${formatEventDateInTz(ev.dateTime, ev.timezone)}" + (if (ev.location.isNotBlank()) "\n📍 ${ev.location}" else "") + "\n👥 ${if (spots > 0) "$spots spot(s) left" else "Full"}\n\n$url"
                context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply { type = "text/plain"; putExtra(Intent.EXTRA_TEXT, text) }, context.getString(R.string.share)))
            })
            DropdownMenuItem(text = { Text(stringResource(R.string.rankings)) }, onClick = { open = false; onRankings() })
            DropdownMenuItem(text = { Text("Payments page") }, onClick = { open = false; onPayments() })
            DropdownMenuItem(text = { Text(stringResource(R.string.history)) }, onClick = { open = false; onAllHistory() })
            DropdownMenuItem(text = { Text("Attendance") }, onClick = { open = false; onAttendance() })
            DropdownMenuItem(text = { Text("Activity log") }, onClick = { open = false; onLog() })
            if (ev.sport in PLAYTOMIC_SPORTS) DropdownMenuItem(text = { Text(stringResource(R.string.courts)) }, onClick = { open = false; onCourtAlternatives() })
            DropdownMenuItem(text = { Text(stringResource(R.string.alerts)) }, onClick = { open = false; onNotificationPrefs() })
            if (state.isAdmin || ev.ownerId == null) DropdownMenuItem(text = { Text(stringResource(R.string.settings)) }, onClick = { open = false; onSettings() })
        }
    }
}

@Composable
private fun HeroWrapUp(eventId: String, state: EventScreenState, viewModel: EventDetailViewModel, user: UserProfile?, editingScoreId: String?, scoreOne: String, scoreTwo: String, onEditScore: (String,String,String)->Unit, onScoreChange: (String,String)->Unit, onSaveScore: ()->Unit, onVoteMvp: (String)->Unit) {
    val pg = state.postGame ?: return
    if (!(pg.isParticipant && !pg.allComplete && (pg.gameEnded || pg.hasPendingPastPayments || (pg.mvpEnabled && !pg.mvpComplete)))) return
    val scoreDone = pg.hasScore; val paysDone = pg.allPaid || !pg.hasCost; val mvpDone = !pg.mvpEnabled || pg.mvpComplete
    val done = (if (scoreDone) 1 else 0) + (if (paysDone) 1 else 0) + (if (mvpDone) 1 else 0); val total = 2 + (if (pg.mvpEnabled) 1 else 0)
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer), shape = RoundedCornerShape(16.dp), modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(Icons.Default.Celebration, null, tint = MaterialTheme.colorScheme.onSecondaryContainer)
                Text("Game over! Wrap it up", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.ExtraBold, color = MaterialTheme.colorScheme.onSecondaryContainer)
            }
            LinearProgressIndicator(progress = { done.toFloat()/total }, modifier = Modifier.fillMaxWidth().height(4.dp).clip(RoundedCornerShape(2.dp)), color = MaterialTheme.colorScheme.primary, trackColor = MaterialTheme.colorScheme.surface)
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) { Icon(if (scoreDone) Icons.Default.CheckCircle else Icons.Default.RadioButtonUnchecked, null, Modifier.size(20.dp)); Text(if (scoreDone) stringResource(R.string.post_game_score_done) else stringResource(R.string.record_final_score), style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f)) }
            if (!scoreDone && pg.latestHistoryId != null) {
                if (editingScoreId == pg.latestHistoryId) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                        OutlinedTextField(value = scoreOne, onValueChange = { onScoreChange(it.filter { c -> c.isDigit() }, scoreTwo) }, modifier = Modifier.width(64.dp), singleLine = true, placeholder = { Text("0") })
                        Text("\u2013", style = MaterialTheme.typography.titleLarge)
                        OutlinedTextField(value = scoreTwo, onValueChange = { onScoreChange(scoreOne, it.filter { c -> c.isDigit() }) }, modifier = Modifier.width(64.dp), singleLine = true, placeholder = { Text("0") })
                        Button(onClick = { val s1=scoreOne.toIntOrNull()?:return@Button; val s2=scoreTwo.toIntOrNull()?:return@Button; viewModel.saveScore(eventId, pg.latestHistoryId, s1, s2); onSaveScore() }) { Text(stringResource(R.string.save), fontWeight = FontWeight.Bold) }
                    }
                } else Button(onClick = { onEditScore(pg.latestHistoryId, "", "") }, modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.record_score)) }
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) { Icon(if (paysDone) Icons.Default.CheckCircle else Icons.Default.RadioButtonUnchecked, null, Modifier.size(20.dp)); val label = when { !pg.hasCost -> stringResource(R.string.post_game_no_cost); paysDone -> stringResource(R.string.post_game_payments_done); state.postGamePayments != null -> stringResource(R.string.post_game_payments_summary, state.postGamePayments.count { it.status=="paid" }, state.postGamePayments.size); else -> stringResource(R.string.post_game_payments_label) }; Text(label, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f)) }
            if (pg.hasCost && !paysDone && !state.postGamePayments.isNullOrEmpty()) {
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    state.postGamePayments.forEach { p -> FilterChip(selected = p.status=="paid", onClick = { viewModel.togglePostGamePayment(p.playerName) }, label = { Text("${p.playerName} %.2f".format(p.amount)) }, leadingIcon = if (p.status=="paid") {{ Icon(Icons.Default.CheckCircle, null, Modifier.size(16.dp)) }} else null) }
                }
                if (state.postGamePaymentsDirty) Button(onClick = { viewModel.savePostGamePayments(eventId) }, enabled = !state.postGameSaving, modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.save), fontWeight = FontWeight.Bold) }
            }
            if (pg.mvpEnabled) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) { Icon(if (mvpDone) Icons.Default.CheckCircle else Icons.Default.RadioButtonUnchecked, null, Modifier.size(20.dp)); Text(if (pg.mvpComplete) stringResource(R.string.post_game_mvp_done) else stringResource(R.string.post_game_mvp_pending), style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f)) }
                val mvpData = state.mvp
                LaunchedEffect(pg.latestHistoryId) {
                    if (pg.latestHistoryId != null && mvpData == null && !state.mvpLoading) viewModel.loadMvp(eventId, pg.latestHistoryId)
                }
                if (state.mvpLoading) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) { CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp) }
                } else if (mvpData != null && mvpData.mvp != null && !mvpData.isVotingOpen) {
                    // Result badge
                    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(MaterialTheme.colorScheme.tertiaryContainer).padding(12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Icon(Icons.Default.EmojiEvents, null, tint = MaterialTheme.colorScheme.tertiary, modifier = Modifier.size(20.dp))
                        Text("MVP:", style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.ExtraBold, color = MaterialTheme.colorScheme.onTertiaryContainer)
                        mvpData.mvp.forEach { cand -> AssistChip(onClick = {}, label = { Text("${cand.playerName} (${cand.voteCount})") }, leadingIcon = { Icon(Icons.Default.EmojiEvents, null, Modifier.size(14.dp)) }) }
                    }
                } else if (mvpData?.isVotingOpen == true) {
                    val myName = user?.name?.lowercase()
                    val myVote = mvpData.votes.find { it.voterName.lowercase() == myName }?.votedForName
                    // Candidate list from current players (fallback) — web uses history participants, we use roster
                    val candidates = state.event?.players?.filter { it.name.lowercase() != myName }?.take(8) ?: emptyList()
                    if (candidates.isNotEmpty()) {
                        Text("Tap to vote (you can change your vote)", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSecondaryContainer)
                        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            candidates.forEach { p ->
                                val pid = p.id
                                val isMyPick = p.name == myVote
                                FilterChip(selected = isMyPick, onClick = { if (pg.latestHistoryId != null) viewModel.voteMvp(eventId, pg.latestHistoryId, pid) }, label = { Text(p.name) }, leadingIcon = if (isMyPick) {{ Icon(Icons.Default.CheckCircle, null, Modifier.size(16.dp)) }} else null)
                            }
                        }
                        // Show current tally if votes exist
                        if (mvpData.votes.isNotEmpty()) {
                            val tally = mvpData.votes.groupBy { it.votedForName }.mapValues { it.value.size }
                            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                tally.forEach { (name, count) -> AssistChip(onClick = {}, label = { Text("$name: $count") }) }
                            }
                        }
                    }
                } else if (pg.isPlayer && !pg.mvpComplete && pg.latestHistoryId != null) {
                    Button(onClick = { onVoteMvp(pg.latestHistoryId) }, modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.post_game_vote_mvp_button)) }
                }
            }
            Text(stringResource(R.string.post_game_progress, done, total), style = MaterialTheme.typography.labelSmall, modifier = Modifier.align(Alignment.CenterHorizontally))
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AddPlayerHeroSection(eventId: String, state: EventScreenState, viewModel: EventDetailViewModel, currentNames: Set<String>, pendingAddSetter: (PendingAdd)->Unit) {
    var query by remember { mutableStateOf("") }
    var expanded by remember { mutableStateOf(false) }
    var choice by remember { mutableStateOf<CoPlaySuggestion?>(null) }
    val context = LocalContext.current
    val isEmail = query.contains("@") && query.contains(".")
    // Merged suggestions: this event's history + global co-players, with a
    // transparent source label per entry.
    val mergedSuggestions = remember(state.knownPlayers, state.coPlayers, currentNames) {
        mergePlayerSuggestions(state.knownPlayers, state.coPlayers, currentNames)
    }
    val filtered by remember(query, mergedSuggestions) {
        derivedStateOf {
            if (query.isBlank()) emptyList()
            else mergedSuggestions.filter { it.name.lowercase().contains(query.lowercase()) }.take(5)
        }
    }
    val showDropdown = expanded && (filtered.isNotEmpty() || query.isNotBlank())

    val contactPicker = rememberLauncherForActivityResult(androidx.activity.result.contract.ActivityResultContracts.StartActivityForResult()) { result ->
        if (result.resultCode == android.app.Activity.RESULT_OK) {
            result.data?.data?.let { uri ->
                runCatching {
                    context.contentResolver.query(uri, arrayOf(android.provider.ContactsContract.CommonDataKinds.Email.ADDRESS, android.provider.ContactsContract.CommonDataKinds.Email.DISPLAY_NAME), null, null, null)?.use { c ->
                        if (c.moveToFirst()) {
                            val n = c.getString(1)?.takeIf { it.isNotBlank() } ?: ""
                            val e = c.getString(0)?.takeIf { it.isNotBlank() }
                            if (e != null) { viewModel.addPlayer(eventId, n, link=false, email=e); query=""; expanded=false } else { query=n; expanded=true }
                        }
                    }
                }
            }
        }
    }

    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        ExposedDropdownMenuBox(
            expanded = showDropdown,
            onExpandedChange = { expanded = it }
        ) {
            OutlinedTextField(
                value = query,
                onValueChange = {
                    query = it
                    expanded = it.isNotBlank()
                },
                placeholder = { Text(stringResource(R.string.add_player_placeholder)) },
                leadingIcon = { Icon(Icons.Default.PersonAdd, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant) },
                trailingIcon = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        if (query.isNotBlank()) {
                            IconButton(onClick = { query = ""; expanded = false }, modifier = Modifier.size(32.dp)) {
                                Icon(Icons.Default.Clear, contentDescription = stringResource(R.string.cancel), tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(16.dp))
                            }
                        }
                        IconButton(onClick = { contactPicker.launch(Intent(Intent.ACTION_PICK, android.provider.ContactsContract.CommonDataKinds.Email.CONTENT_URI)) }, modifier = Modifier.size(32.dp)) {
                            Icon(Icons.Default.Contacts, contentDescription = stringResource(R.string.add_from_contacts), tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(18.dp))
                        }
                        FilledTonalIconButton(
                            onClick = {
                                if (query.isNotBlank()) {
                                    // Exact match against merged suggestions → confirm dialog; otherwise direct add
                                    val exact = mergedSuggestions.find { it.name.equals(query.trim(), ignoreCase = true) }
                                    if (exact != null) pendingAddSetter(PendingAdd(exact.name, userId = exact.userId)) else viewModel.addPlayer(eventId, query.trim())
                                    query = ""; expanded = false
                                }
                            },
                            enabled = query.isNotBlank(),
                            modifier = Modifier.size(36.dp),
                            colors = IconButtonDefaults.filledTonalIconButtonColors(containerColor = MaterialTheme.colorScheme.primary, contentColor = MaterialTheme.colorScheme.onPrimary)
                        ) {
                            Icon(Icons.Default.Add, contentDescription = stringResource(R.string.add_button), modifier = Modifier.size(18.dp))
                        }
                        Spacer(Modifier.width(4.dp))
                    }
                },
                shape = RoundedCornerShape(28.dp),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = MaterialTheme.colorScheme.primary,
                    unfocusedBorderColor = MaterialTheme.colorScheme.outlineVariant,
                    focusedContainerColor = MaterialTheme.colorScheme.surface,
                    unfocusedContainerColor = MaterialTheme.colorScheme.surface
                ),
                singleLine = true,
                modifier = Modifier.menuAnchor(ExposedDropdownMenuAnchorType.PrimaryEditable).fillMaxWidth()
            )
            ExposedDropdownMenu(
                expanded = showDropdown,
                onDismissRequest = { expanded = false }
            ) {
                filtered.forEach { s ->
                    DropdownMenuItem(
                        text = {
                            Column {
                                Text(s.name, style = MaterialTheme.typography.bodyMedium)
                                Text(
                                    when {
                                        s.gamesPlayedHere > 0 -> "${s.gamesPlayedHere} games here"
                                        s.coPlayCount > 0 -> "played with you ${s.coPlayCount}\u00d7"
                                        else -> "suggested"
                                    },
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        },
                        leadingIcon = {
                            Icon(
                                if (s.source == SuggestionSource.EVENT) Icons.Default.History else Icons.Default.Group,
                                contentDescription = null,
                                modifier = Modifier.size(18.dp),
                                tint = if (s.source == SuggestionSource.EVENT) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.tertiary,
                            )
                        },
                        onClick = { pendingAddSetter(PendingAdd(s.name, userId = s.userId)); query = ""; expanded = false }
                    )
                }
                if (query.isNotBlank() && filtered.none { it.name.equals(query.trim(), ignoreCase = true) }) {
                    DropdownMenuItem(
                        text = { Text("Add \"${query.trim()}\" as new player", fontStyle = androidx.compose.ui.text.font.FontStyle.Italic) },
                        leadingIcon = { Icon(Icons.Default.PersonAdd, contentDescription = null, modifier = Modifier.size(18.dp)) },
                        onClick = { pendingAddSetter(PendingAdd(query.trim())); query = ""; expanded = false }
                    )
                }
                if (isEmail) {
                    DropdownMenuItem(
                        text = { Text("Invite by email: ${query.trim()}") },
                        leadingIcon = { Icon(Icons.Default.Email, contentDescription = null, modifier = Modifier.size(18.dp)) },
                        onClick = {
                            val namePart = query.substringBefore("@").ifBlank { query.trim() }
                            viewModel.addPlayer(eventId, namePart, link = false, email = query.trim()); query = ""; expanded = false
                        }
                    )
                }
            }
        }

        // Quick suggestions when empty — merged list, labeled by source
        if (query.isBlank() && mergedSuggestions.isNotEmpty()) {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("Suggestions", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    for (s in mergedSuggestions.take(5)) {
                        AssistChip(
                            onClick = { pendingAddSetter(PendingAdd(s.name, userId = s.userId)) },
                            label = {
                                Column {
                                    Text(s.name, style = MaterialTheme.typography.labelLarge)
                                    Text(
                                        when {
                                            s.gamesPlayedHere > 0 -> "${s.gamesPlayedHere}g here"
                                            s.coPlayCount > 0 -> "${s.coPlayCount}\u00d7 with you"
                                            else -> "suggested"
                                        },
                                        style = MaterialTheme.typography.labelSmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                            },
                            leadingIcon = {
                                Icon(
                                    if (s.source == SuggestionSource.EVENT) Icons.Default.History else Icons.Default.Group,
                                    contentDescription = null,
                                    modifier = Modifier.size(16.dp),
                                    tint = if (s.source == SuggestionSource.EVENT) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.tertiary,
                                )
                            }
                        )
                    }
                }
            }
        }
        if (state.coPlaySuggestions.isNotEmpty()) {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text("Frequently played with", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        for (s in state.coPlaySuggestions) {
                            AssistChip(
                                onClick = { choice = s },
                                label = { Text(s.name) },
                                leadingIcon = { Icon(Icons.Default.Group, contentDescription = null, modifier = Modifier.size(16.dp)) }
                            )
                        }
                    }
                }
                choice?.let { sel ->
                    AlertDialog(
                        onDismissRequest = { choice = null },
                        title = { Text("Invite ${sel.name}?") },
                        text = { Text("${sel.name} has played ${sel.gamesPlayed} games with you. Add them directly to the roster or send them an invite to join?") },
                        confirmButton = {
                            TextButton(onClick = { viewModel.inviteSuggestion(eventId, sel.userId, sel.name); choice = null }) { Text("Invite") }
                        },
                        dismissButton = {
                            TextButton(onClick = { viewModel.addPlayer(eventId, sel.name, link = false); choice = null }) { Text("Add to list") }
                        }
                    )
                }
            }
        }
    }

@Composable
private fun NotificationToggleRow(label: String, muted: Boolean?, onToggle: (Boolean?) -> Unit) {
    val enabled = muted != true
    Row(Modifier.fillMaxWidth().padding(vertical=4.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
        Text(label, style = MaterialTheme.typography.bodyLarge); Switch(checked = enabled, onCheckedChange = { c -> onToggle(if (c) null else true) })
    }
}

// Keep legacy small views for preview compat

private fun demoStateForHero(): EventScreenState {
    val now = java.time.Instant.now()
    val ev = demoEventForPreview(now.plus(java.time.Duration.ofHours(5)), false, null, "Weekly · Thu 19:00")
    val history = listOf(
        GameHistory(id = "h1", dateTime = now.minus(java.time.Duration.ofDays(7)).toString(), scoreOne = 5, scoreTwo = 3, teamOneName = "Whites", teamTwoName = "Blues", eloUpdates = listOf(EloUpdate("Marta", 12), EloUpdate("João", -8))),
        GameHistory(id = "h2", dateTime = now.minus(java.time.Duration.ofDays(14)).toString(), scoreOne = 2, scoreTwo = 2, teamOneName = "Whites", teamTwoName = "Blues"),
    )
    val payments = listOf(PaymentSnapshotEntry("Marta", 5.0, "paid"), PaymentSnapshotEntry("João", 5.0, "pending"), PaymentSnapshotEntry("Alex", 5.0, "paid"))
    val postGame = PostGameStatus(gameEnded = true, hasScore = false, hasCost = true, allPaid = false, allComplete = false, isParticipant = true, isPlayer = true, latestHistoryId = "h1", costAmount = 15.0, hasPendingPastPayments = false, paymentsSnapshot = payments, mvpEnabled = true, mvpComplete = false, paidAggregate = PaidAggregate(2,3))
    val balance = BalanceResponse(enforcement = "nudge", callerBalance = PlayerBalance("João", 5.0, 1, 3), aggregate = BalanceAggregate(6,9))
    val demoMvp = MvpResponse(mvp = null, votes = emptyList(), isVotingOpen = true, hasVoted = false, totalVotes = 0)
    val demoCost = EventCost(totalAmount = 30.0, currency = "EUR")
    val demoCoPlayers = listOf(CoPlayer("Bruno", "u-bruno", null, 6), CoPlayer("Diana", "u-diana", null, 3))
    return EventScreenState(loading = false, event = ev, history = history, knownPlayers = listOf(KnownPlayer("Rui",12), KnownPlayer("Sofia",8)), postGame = postGame, postGamePayments = payments, mvp = demoMvp, cost = demoCost, coPlayers = demoCoPlayers, isFollowing = true, isPlayer = false, isAdmin = true, balance = balance, coPlaySuggestions = listOf(CoPlaySuggestion("u2","Marta", gamesPlayed=9), CoPlaySuggestion("u3","Alex", gamesPlayed=6)))
}

private fun demoEventForPreview(at: java.time.Instant, isRecurring: Boolean, nextResetAt: java.time.Instant?, recurrenceRule: String?): EventDetail {
    val players = listOf(
        Player("p1", "Marta", 0, "u2"),
        Player("p2", "João", 1, "u_demo"),
        Player("p3", "Alex", 2, "u3"),
        Player("p4", "Sofia", 3),
        Player("p5", "Rui", 4),
        Player("p6", "Tiago", 5),
        Player("p7", "Inês", 6),
        Player("p8", "Nuno", 7),
        Player("p9", "Carla", 8),
    )
    return EventDetail(
        id = "demo", title = "Thursday 5-a-side", location = "Riverside Astro, Pitch 2", latitude = 38.7223, longitude = -9.1393,
        dateTime = at.toString(), timezone = "Europe/Lisbon", maxPlayers = 10, teamOneName = "Whites", teamTwoName = "Blues",
        sport = "football", durationMinutes = 90, isRecurring = isRecurring, recurrenceRule = recurrenceRule, nextResetAt = nextResetAt?.toString(),
        ownerId = "u_demo", ownerName = "João", isAdmin = true, eloEnabled = true, splitCostsEnabled = true, mvpEnabled = true,
        players = players,
        teamResults = listOf(
            TeamResult("t1", "Whites", listOf(TeamMember("p1", "Marta", 0), TeamMember("p3", "Alex", 1), TeamMember("p5", "Rui", 2))),
            TeamResult("t2", "Blues", listOf(TeamMember("p2", "João", 0), TeamMember("p4", "Sofia", 1), TeamMember("p6", "Tiago", 2))),
        ),
        invited = listOf(RosterPlayer("i1", "Hugo"), RosterPlayer("i2", "Beatriz")),
        declined = listOf(RosterPlayer("d1", "Marco")),
    )
}

@Composable fun SectionTitle(text: String) { Text(text, color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.labelMedium, letterSpacing = 1.sp, modifier = Modifier.padding(top=16.dp, bottom=8.dp).semantics { heading() }) }
@Composable fun EventHeader(title: String, dateLabel: String, location: String, modifier: Modifier=Modifier) { Column(modifier){ Text(title, style=MaterialTheme.typography.titleLarge, modifier=Modifier.semantics{heading()}); Text(dateLabel, style=MaterialTheme.typography.bodyMedium, color=MaterialTheme.colorScheme.onSurfaceVariant); if(location.isNotBlank()) Text(location, style=MaterialTheme.typography.bodySmall, color=MaterialTheme.colorScheme.outline) } }
@Composable fun CreateTeamsCard(onBalanced:()->Unit,onRandom:()->Unit,modifier:Modifier=Modifier){ Card(modifier=modifier.fillMaxWidth().padding(bottom=12.dp)){ Column(Modifier.padding(16.dp), verticalArrangement=Arrangement.spacedBy(8.dp)){ Text(stringResource(R.string.create_teams_title), style=MaterialTheme.typography.titleMedium); Text(stringResource(R.string.create_teams_desc), style=MaterialTheme.typography.bodySmall, color=MaterialTheme.colorScheme.onSurfaceVariant); Row(horizontalArrangement=Arrangement.spacedBy(8.dp)){ Button(onClick=onBalanced, modifier=Modifier.weight(1f)){ Icon(Icons.Default.Balance,null,Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text(stringResource(R.string.teams_balanced)) }; OutlinedButton(onClick=onRandom, modifier=Modifier.weight(1f)){ Icon(Icons.Default.Shuffle,null,Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text(stringResource(R.string.teams_random)) } } } } }
@Composable fun TeamsCard(teams: List<TeamResult>, players: List<Player>, onMovePlayer:(String,String,Boolean)->Unit, modifier:Modifier=Modifier){ Card(modifier=modifier.fillMaxWidth().padding(bottom=12.dp)){ Row(Modifier.padding(14.dp)){ TeamColumn(teams[0], players, false, onMovePlayer, Modifier.weight(1f)); Text(stringResource(R.string.vs), color=MaterialTheme.colorScheme.outline, fontWeight=FontWeight.Bold, modifier=Modifier.padding(horizontal=8.dp, vertical=16.dp)); TeamColumn(teams[1], players, true, onMovePlayer, Modifier.weight(1f)) } } }
@Composable private fun TeamColumn(team: TeamResult, players: List<Player>, toTeamOne:Boolean, onMovePlayer:(String,String,Boolean)->Unit, modifier:Modifier=Modifier){ Column(modifier, horizontalAlignment=Alignment.CenterHorizontally){ Text(team.name, color=MaterialTheme.colorScheme.primary, style=MaterialTheme.typography.labelMedium); team.members.forEach{ m -> val pid=players.find{it.name==m.name}?.id; Text(m.name, color=MaterialTheme.colorScheme.onSurfaceVariant, style=MaterialTheme.typography.bodySmall, modifier=if(pid!=null) Modifier.clickable{onMovePlayer(pid,m.name,toTeamOne)} else Modifier) } } }
@Composable fun RosterStatusList(names: List<String>){ Card(modifier=Modifier.fillMaxWidth()){ Column{ names.forEachIndexed{i,n-> Text(n, style=MaterialTheme.typography.bodyMedium, color=MaterialTheme.colorScheme.onSurfaceVariant, modifier=Modifier.fillMaxWidth().padding(horizontal=16.dp, vertical=8.dp)); if(i<n.lastIndex) HorizontalDivider(color=MaterialTheme.colorScheme.outlineVariant) } } } }
@Composable fun PlayerListCard(players: List<Player>, currentUserId: String?, isOwner: Boolean, onRemove:(String)->Unit, onUserClick:(String)->Unit={}, modifier:Modifier=Modifier, isBench:Boolean=false){ Card(modifier=modifier.fillMaxWidth()){ Column{ players.forEachIndexed{i,p-> PlayerRow(player=p, isMe=p.userId==currentUserId, isBench=isBench, onRemove={onRemove(p.id)}, onUserClick=p.userId?.let{{onUserClick(it)}}?:{}, canRemove=isOwner||p.userId==currentUserId||p.userId==null); if(i<players.lastIndex) HorizontalDivider(color=MaterialTheme.colorScheme.outlineVariant) } } } }
@Composable fun PlayerAvatar(name:String,image:String?,isMe:Boolean,onClick:()->Unit,modifier:Modifier=Modifier){ val bg=if(isMe) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceVariant; val fg=if(isMe) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurfaceVariant; Box(modifier.size(24.dp).clip(CircleShape).background(bg).clickable(onClick=onClick), Alignment.Center){ if(image!=null) SubcomposeAsyncImage(model=image, contentDescription=name, modifier=Modifier.fillMaxSize(), loading={ InitialAvatar(name, fg) }, error={ InitialAvatar(name, fg) }) else InitialAvatar(name, fg) } }
@Composable fun PlayerRow(player: Player, isMe:Boolean=false, isBench:Boolean=false, canRemove:Boolean=false, onRemove:()->Unit={}, onUserClick:()->Unit={},){ ListItem(headlineContent={ Text("${player.name}${if(isMe) stringResource(R.string.you_suffix) else ""}", color=if(isBench) MaterialTheme.colorScheme.outline else MaterialTheme.colorScheme.onSurface, fontWeight=if(isMe) FontWeight.SemiBold else FontWeight.Normal, style=MaterialTheme.typography.bodyMedium)}, leadingContent={ if(player.userId!=null) PlayerAvatar(player.name, player.image, isMe, onUserClick) else Icon(Icons.Outlined.Person, stringResource(R.string.anonymous_player), tint=MaterialTheme.colorScheme.outline, modifier=Modifier.size(20.dp))}, trailingContent=if(canRemove){{IconButton(onClick=onRemove, modifier=Modifier.size(32.dp)){ Icon(Icons.Default.Close, stringResource(R.string.remove), tint=MaterialTheme.colorScheme.outline, modifier=Modifier.size(16.dp))}}} else null, colors=ListItemDefaults.colors(containerColor=Color.Transparent), modifier=Modifier.height(44.dp)) }

@OptIn(ExperimentalMaterial3Api::class)
@Composable fun InvitedRow(player: RosterPlayer, resending: Boolean, removing: Boolean, onResend: () -> Unit, onRemove: (() -> Unit)?) {
    val cooldown = resendCooldownRemaining(player.notifiedAt)
    val inCooldown = cooldown != null
    val tooltipState = rememberTooltipState()
    ListItem(
        headlineContent = { Text(player.name, style = MaterialTheme.typography.bodyMedium) },
        supportingContent = {
            channelLabels(player.channels)?.let { channels ->
                Text(channels, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        },
        leadingContent = { PlayerAvatar(player.name, player.image, false, {}) },
        trailingContent = {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                TooltipBox(
                    state = tooltipState,
                    tooltip = {
                        PlainTooltip {
                            Text(
                                cooldown?.let { stringResource(R.string.invite_resend_cooldown, formatCooldownRemaining(it)) }
                                    ?: stringResource(R.string.resend),
                            )
                        }
                    },
                    positionProvider = TooltipDefaults.rememberTooltipPositionProvider(TooltipAnchorPosition.Above),
                ) {
                    TextButton(
                        onClick = onResend,
                        enabled = !resending && !removing && !inCooldown,
                        contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp),
                    ) {
                        when {
                            resending -> CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                            inCooldown -> Text(formatCooldownRemaining(requireNotNull(cooldown)), color = MaterialTheme.colorScheme.outline)
                            else -> Text(stringResource(R.string.resend))
                        }
                    }
                }
                onRemove?.let {
                    IconButton(onClick = it, enabled = !removing && !resending, modifier = Modifier.size(32.dp)) {
                        if (removing) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                        else Icon(Icons.Default.Close, stringResource(R.string.remove), tint = MaterialTheme.colorScheme.outline, modifier = Modifier.size(16.dp))
                    }
                }
            }
        },
        colors = ListItemDefaults.colors(containerColor = Color.Transparent),
    )
}

@Composable private fun channelLabels(channels: InviteChannels): String? {
    val labels = buildList {
        if (channels.email) add(stringResource(R.string.channel_email))
        if (channels.webPush) add(stringResource(R.string.channel_web_push))
        if (channels.appPush) add(stringResource(R.string.channel_app_push))
    }
    return labels.takeIf { it.isNotEmpty() }?.joinToString(", ")
}
@Composable fun HistoryCard(h: GameHistory, editingScoreId: String?, scoreOne: String, scoreTwo: String, onClick:()->Unit={}, onEditScore:()->Unit, onScoreOneChange:(String)->Unit, onScoreTwoChange:(String)->Unit, onSaveScore:()->Unit){ Card(modifier=Modifier.fillMaxWidth().padding(bottom=6.dp).clickable(onClick=onClick)){ Column(Modifier.padding(12.dp)){ Text(formatRelativeDate(h.dateTime), color=MaterialTheme.colorScheme.outline, style=MaterialTheme.typography.bodySmall); if(h.scoreOne!=null&&h.scoreTwo!=null) Text("${h.teamOneName} ${h.scoreOne} - ${h.scoreTwo} ${h.teamTwoName}", style=MaterialTheme.typography.titleSmall, modifier=Modifier.clickable(onClick=onEditScore)) else { if(editingScoreId==h.id){ Row(verticalAlignment=Alignment.CenterVertically, horizontalArrangement=Arrangement.spacedBy(8.dp), modifier=Modifier.padding(top=4.dp)){ OutlinedTextField(value=scoreOne, onValueChange=onScoreOneChange, modifier=Modifier.width(50.dp), singleLine=true); Text("-", color=MaterialTheme.colorScheme.outline, fontWeight=FontWeight.Bold); OutlinedTextField(value=scoreTwo, onValueChange=onScoreTwoChange, modifier=Modifier.width(50.dp), singleLine=true); Button(onClick=onSaveScore){ Text(stringResource(R.string.save)) } } } else TextButton(onClick=onEditScore){ Text(stringResource(R.string.add_score), color=MaterialTheme.colorScheme.primary, fontWeight=FontWeight.SemiBold)} } ; h.eloUpdates?.takeIf{it.isNotEmpty()}?.let{ ups-> Row(Modifier.padding(top=6.dp), horizontalArrangement=Arrangement.spacedBy(6.dp)){ ups.forEach{eu-> Text("${eu.name} ${if(eu.delta>0) "+" else ""}${eu.delta}", color=if(eu.delta>0) MaterialTheme.colorScheme.primary else if(eu.delta<0) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.outline, style=MaterialTheme.typography.labelSmall, fontWeight=FontWeight.SemiBold)}} } } } }

