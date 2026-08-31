package dev.convocados.wear.ui.screen.teams

import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.wear.compose.foundation.lazy.TransformingLazyColumn
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.foundation.lazy.rememberTransformingLazyColumnState
import androidx.wear.compose.material3.*
import androidx.wear.compose.material3.lazy.rememberTransformationSpec
import androidx.wear.compose.material3.lazy.transformedHeight
import dev.convocados.wear.R
import dev.convocados.wear.ui.RememberKeepScreenOn
import dev.convocados.wear.ui.screen.settings.GameSettingsViewModel

@Composable
fun AddPlayerScreen(
    eventId: String,
    viewModel: AddPlayerViewModel,
    settingsViewModel: GameSettingsViewModel,
    onDone: () -> Unit = {},
) {
    LaunchedEffect(eventId) {
        viewModel.load(eventId)
        settingsViewModel.load(eventId)
    }
    val state by viewModel.uiState.collectAsState()
    val settingsState by settingsViewModel.uiState.collectAsState()
    RememberKeepScreenOn(settingsState.keepScreenOn && !settingsState.isLoading)
    val columnState = rememberTransformingLazyColumnState()
    val transformationSpec = rememberTransformationSpec()

    ScreenScaffold(scrollState = columnState) { contentPadding ->
        TransformingLazyColumn(
            state = columnState,
            contentPadding = contentPadding,
            modifier = Modifier.fillMaxSize(),
        ) {
            item {
                ListHeader(
                    modifier = Modifier
                        .fillMaxWidth()
                        .transformedHeight(this, transformationSpec)
                        .minimumVerticalContentPadding(ListHeaderDefaults.minimumTopListContentPadding),
                    transformation = SurfaceTransformation(transformationSpec),
                ) {
                    Text(
                        text = stringResource(R.string.add_player_title),
                        style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.primary,
                    )
                }
            }

            if (state.isLoading) {
                item { CircularProgressIndicator(modifier = Modifier.fillMaxWidth().padding(8.dp)) }
            } else if (state.known.isEmpty()) {
                item {
                    Text(
                        text = stringResource(R.string.no_known_players),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.fillMaxWidth().padding(8.dp),
                    )
                }
            } else {
                items(state.known, key = { it.name }) { player ->
                    Button(
                        onClick = { viewModel.add(eventId, player.name) },
                        modifier = Modifier.fillMaxWidth(),
                        enabled = state.adding == null,
                        label = {
                            Text(text = player.name, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        },
                        secondaryLabel = {
                            if (state.adding == player.name) {
                                Text(
                                    text = stringResource(R.string.adding_label),
                                    style = MaterialTheme.typography.labelSmall,
                                )
                            }
                        },
                    )
                }
            }

            state.error?.let { error ->
                item {
                    Text(
                        text = error,
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.error,
                        modifier = Modifier.fillMaxWidth().padding(8.dp),
                    )
                }
            }

            item {
                CompactButton(
                    onClick = onDone,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(stringResource(R.string.done_label))
                }
            }
        }
    }
}