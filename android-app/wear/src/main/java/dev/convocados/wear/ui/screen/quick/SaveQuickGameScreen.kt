package dev.convocados.wear.ui.screen.quick

import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
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
import dev.convocados.designsystem.ExpressiveSemanticRole
import dev.convocados.wear.ui.roundSafeWidth
import dev.convocados.wear.ui.roundBezelClip
import dev.convocados.wear.ui.theme.expressiveTokens

@Composable
fun SaveQuickGameScreen(
    viewModel: SaveQuickGameViewModel,
    onDone: () -> Unit = {},
) {
    LaunchedEffect(Unit) { viewModel.load() }
    val state by viewModel.uiState.collectAsState()
    SaveQuickGameContent(
        state = state,
        onDone = onDone,
        onSave = viewModel::saveTo,
    )
}

/**
 * Stateless renderer for deterministic previews and shape-regression
 * screenshots. Production lifecycle lives in [SaveQuickGameScreen].
 */
@Composable
internal fun SaveQuickGameContent(
    state: SaveQuickGameUiState,
    onDone: () -> Unit = {},
    onSave: (String) -> Unit = {},
) {
    val tokens = expressiveTokens()
    val columnState = rememberTransformingLazyColumnState()
    val transformationSpec = rememberTransformationSpec()

    Box(
        Modifier
            .fillMaxSize()
            .roundBezelClip(),
    ) {
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
                            text = stringResource(R.string.save_quick_title),
                            style = MaterialTheme.typography.titleMedium,
                            color = MaterialTheme.colorScheme.primary,
                        )
                           }
    }

                if (state.saved) {
                    item {
                        Text(
                            text = stringResource(R.string.save_quick_saved),
                            style = MaterialTheme.typography.bodyMedium,
                            color = tokens.colorFor(ExpressiveSemanticRole.Success),
                            modifier = Modifier.fillMaxWidth().padding(8.dp),
                        )
                    }
                } else {
                    state.quick?.let { quick ->
                        item {
                            val setSummary = quick.scoreSets.joinToString(" · ") { set ->
                                if (set.tiebreakTeamOne != null && set.tiebreakTeamTwo != null) {
                                    "${set.teamOne}-${set.teamTwo} (${set.tiebreakTeamOne}-${set.tiebreakTeamTwo})"
                                } else {
                                    "${set.teamOne}-${set.teamTwo}"
                                }
                            }
                            Text(
                                text = if (isQuickStructuredSport(quick.sport) && setSummary.isNotEmpty()) {
                                    stringResource(R.string.save_quick_score_sets, setSummary, quick.scoreOne, quick.scoreTwo)
                                } else {
                                    stringResource(R.string.save_quick_score, quick.scoreOne, quick.scoreTwo)
                                },
                                style = MaterialTheme.typography.labelMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.fillMaxWidth().padding(8.dp),
                            )
                        }
                    }

                    items(state.events, key = { it.id }) { event ->
                        Button(
                            onClick = { onSave(event.id) },
                            modifier = Modifier.fillMaxWidth(),
                            enabled = state.saving == null,
                            label = {
                                Text(text = event.title, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            },
                        )
                    }

                    if (state.events.isEmpty()) {
                        item {
                            Text(
                                text = stringResource(R.string.save_quick_no_events),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.fillMaxWidth().padding(8.dp),
                            )
                        }
                    }
                }

                state.error?.let { error ->
                    item {
                        Text(
                            text = error,
                            style = MaterialTheme.typography.labelSmall,
                            color = tokens.colorFor(ExpressiveSemanticRole.Error),
                            modifier = Modifier.fillMaxWidth().padding(8.dp),
                        )
                    }
                }

                item {
                    Column(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        CompactButton(
                            onClick = onDone,
                            // Keep the trailing action clear of the round bezel.
                            modifier = Modifier.roundSafeWidth(),
                        ) {
                            Text(stringResource(R.string.done_label))
                        }
                        Spacer(modifier = Modifier.height(16.dp))
                    }
                }
            }
    
 }
    }
}