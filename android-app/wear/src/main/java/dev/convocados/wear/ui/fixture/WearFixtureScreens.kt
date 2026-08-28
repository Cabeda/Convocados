package dev.convocados.wear.ui.fixture

import androidx.compose.foundation.layout.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.wear.compose.foundation.lazy.TransformingLazyColumn
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.foundation.lazy.rememberTransformingLazyColumnState
import androidx.wear.compose.material3.*
import androidx.wear.compose.material3.lazy.rememberTransformationSpec
import androidx.wear.compose.material3.lazy.transformedHeight
import dev.convocados.wear.R
import dev.convocados.wear.data.local.entity.WearGameEntity
import dev.convocados.wear.ui.screen.games.GameChip
import dev.convocados.wear.util.formatRelativeTime

import java.time.Instant

/** Deterministic Wear list renderer for emulator review and store captures. */
@Composable
fun WearGamesFixtureContent(
    games: List<WearGameEntity>,
    pendingSyncCount: Int = 0,
    offline: Boolean = false,
    now: Instant = Instant.parse("2026-08-28T10:30:00Z"),
    onGameSelected: (String) -> Unit = {},
    onQuickGame: () -> Unit = {},
    onHistory: () -> Unit = {},
) {
    val columnState = rememberTransformingLazyColumnState()
    val transformationSpec = rememberTransformationSpec()

    ScreenScaffold(scrollState = columnState) { contentPadding ->
        if (games.isEmpty()) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.padding(20.dp)) {
                    Text(stringResource(if (offline) R.string.offline_cached else R.string.no_games), textAlign = TextAlign.Center)
                    Spacer(Modifier.height(8.dp))
                    CompactButton(onClick = onQuickGame) { Text(stringResource(R.string.quick_game)) }
                }
            }
        } else {
            TransformingLazyColumn(state = columnState, contentPadding = contentPadding) {
                item {
                    ListHeader(
                        modifier = Modifier
                            .fillMaxWidth()
                            .transformedHeight(this, transformationSpec)
                            .minimumVerticalContentPadding(ListHeaderDefaults.minimumTopListContentPadding),
                        transformation = SurfaceTransformation(transformationSpec),
                    ) {
                        Text(stringResource(R.string.games_title), style = MaterialTheme.typography.titleMedium)
                    }
                }
                if (pendingSyncCount > 0) {
                    item {
                        Text(
                            stringResource(R.string.pending_sync, pendingSyncCount),
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.tertiary,
                            modifier = Modifier.fillMaxWidth(),
                            textAlign = TextAlign.Center,
                        )
                    }
                }
                if (offline) {
                    item {
                        Text(
                            stringResource(R.string.offline_cached),
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.fillMaxWidth(),
                            textAlign = TextAlign.Center,
                        )
                    }
                }
                items(games, key = { it.id }) { game ->
                    GameChip(
                        game = game,
                        isSuggested = false,
                        canScore = true,
                        onClick = { onGameSelected(game.id) },
                        nowOverride = now,
                    )
                }
                item {
                    CompactButton(onClick = onQuickGame) { Text(stringResource(R.string.quick_game)) }
                }
                item {
                    CompactButton(onClick = onHistory) { Text(stringResource(R.string.history_title)) }
                }
            }
        }
    }
}


/** Deterministic history renderer used by Wear screenshot and store-listing fixtures. */
@Composable
fun WearHistoryFixtureContent(
    histories: List<dev.convocados.wear.data.local.entity.WearHistoryEntity>,
    now: Instant = Instant.parse("2026-08-28T10:30:00Z"),
) {
    val columnState = rememberTransformingLazyColumnState()
    val transformationSpec = rememberTransformationSpec()

    ScreenScaffold(scrollState = columnState) { contentPadding ->
        TransformingLazyColumn(state = columnState, contentPadding = contentPadding) {
            item {
                ListHeader(
                    modifier = Modifier
                        .fillMaxWidth()
                        .transformedHeight(this, transformationSpec)
                        .minimumVerticalContentPadding(ListHeaderDefaults.minimumTopListContentPadding),
                    transformation = SurfaceTransformation(transformationSpec),
                ) {
                    Text(stringResource(R.string.history_title), style = MaterialTheme.typography.titleMedium)
                }
            }
            items(histories, key = { it.id }) { history ->
                Button(
                    onClick = {},
                    modifier = Modifier.fillMaxWidth(),
                    label = {
                        Text(
                            text = "${history.teamOneName} · ${history.teamTwoName}",
                            maxLines = 1,
                        )
                    },
                    secondaryLabel = {
                        Text(
                            text = "${formatRelativeTime(history.dateTime, now)} · ${history.scoreOne ?: 0} – ${history.scoreTwo ?: 0}",
                            style = MaterialTheme.typography.labelSmall,
                        )
                    },
                )
            }
        }
    }
}
