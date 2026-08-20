package dev.convocados.ui.screen.invite

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
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
import dev.convocados.data.api.InviteLookupResponse
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class InviteState(
    val loading: Boolean = true,
    val data: InviteLookupResponse? = null,
    val error: String? = null,
    val busy: Boolean = false,
    val responded: Boolean = false,
)

@HiltViewModel
class InviteViewModel @Inject constructor(
    private val api: ConvocadosApi,
) : ViewModel() {
    private val _state = MutableStateFlow(InviteState())
    val state: StateFlow<InviteState> = _state

    init { load() }

    fun load() {
        viewModelScope.launch {
            runCatching { api.fetchInvite(_state.value.data?.token.orEmpty()) }
                .onSuccess { _state.value = InviteState(loading = false, data = it) }
                .onFailure { _state.value = InviteState(loading = false, error = it.message) }
        }
    }

    fun respond(action: String) {
        val token = _state.value.data?.token ?: return
        _state.value = _state.value.copy(busy = true, error = null)
        viewModelScope.launch {
            runCatching { api.respondToInvite(token, action) }
                .onSuccess { _state.value = _state.value.copy(busy = false, responded = true) }
                .onFailure { _state.value = _state.value.copy(busy = false, error = it.message) }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun InviteScreen(
    token: String,
    onBack: () -> Unit,
    onViewGame: (String) -> Unit,
    viewModel: InviteViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsState()

    LaunchedEffect(token) {
        // Re-load on token change (deep link resumes after sign-in)
        viewModel.load()
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.invite_page_title)) },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back)) } },
            )
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding), Alignment.Center) {
            when {
                state.loading -> CircularProgressIndicator()
                state.error != null -> Text(state.error!!, color = MaterialTheme.colorScheme.error)
                state.data == null -> Text(stringResource(R.string.invite_not_found))
                !state.data!!.valid -> Text(stringResource(R.string.invite_not_found))
                else -> {
                    val d = state.data!!
                    when (d.status) {
                        "expired" -> StatusText(stringResource(R.string.invite_expired))
                        "accepted" -> StatusText(stringResource(R.string.invite_accepted)) { Button(onClick = { onViewGame(d.game?.id.orEmpty()) }) { Text(stringResource(R.string.invite_view_game)) } }
                        "declined" -> StatusText(stringResource(R.string.invite_declined)) { Button(onClick = { onViewGame(d.game?.id.orEmpty()) }) { Text(stringResource(R.string.invite_view_game)) } }
                        "cancelled" -> StatusText(stringResource(R.string.invite_cancelled)) { Button(onClick = { onViewGame(d.game?.id.orEmpty()) }) { Text(stringResource(R.string.invite_view_game)) } }
                        else -> if (state.responded) {
                            StatusText(stringResource(R.string.invite_accepted)) { Button(onClick = { onViewGame(d.game?.id.orEmpty()) }) { Text(stringResource(R.string.invite_view_game)) } }
                        } else {
                            Column(
                                Modifier.verticalScroll(rememberScrollState()).padding(24.dp),
                                horizontalAlignment = Alignment.CenterHorizontally,
                            ) {
                                Text(d.game?.title.orEmpty(), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                                Spacer(Modifier.height(8.dp))
                                val location = d.game?.location.orEmpty()
                                if (location.isNotEmpty()) {
                                    Text(location, color = MaterialTheme.colorScheme.outline)
                                    Spacer(Modifier.height(4.dp))
                                }
                                val dateTime = runCatching { java.time.OffsetDateTime.parse(d.game?.dateTime.orEmpty()) }.getOrNull()
                                if (dateTime != null) {
                                    val fmt = java.time.format.DateTimeFormatter.ofLocalizedDateTime(java.time.format.FormatStyle.MEDIUM)
                                    Text(fmt.format(dateTime), color = MaterialTheme.colorScheme.outline)
                                }
                                Spacer(Modifier.height(16.dp))
                                Text(stringResource(R.string.invite_invited_by, d.invitedByName))
                                Spacer(Modifier.height(24.dp))
                                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                    Button(
                                        onClick = { viewModel.respond("accept") },
                                        enabled = !state.busy,
                                    ) { Text(stringResource(R.string.invite_accept)) }
                                    OutlinedButton(
                                        onClick = { viewModel.respond("decline") },
                                        enabled = !state.busy,
                                    ) { Text(stringResource(R.string.invite_decline)) }
                                }
                                if (state.error != null) {
                                    Spacer(Modifier.height(12.dp))
                                    Text(state.error!!, color = MaterialTheme.colorScheme.error)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun StatusText(text: String, actions: (@Composable () -> Unit)? = null) {
    Column(
        Modifier.padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(text, style = MaterialTheme.typography.bodyLarge)
        if (actions != null) {
            Spacer(Modifier.height(16.dp))
            actions()
        }
    }
}