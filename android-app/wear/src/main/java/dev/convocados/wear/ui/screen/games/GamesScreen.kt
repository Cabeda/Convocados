package dev.convocados.wear.ui.screen.games

import androidx.compose.foundation.layout.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.material.*
import dev.convocados.wear.data.local.entity.WearGameEntity
import dev.convocados.wear.ui.theme.Success
import dev.convocados.wear.ui.theme.TextMuted
import dev.convocados.wear.ui.theme.Warning
import java.time.Instant
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit

@Composable
fun GamesScreen(
    viewModel: GamesViewModel,
    onGameSelected: (String) -> Unit,
) {
    val state by viewModel.uiState.collectAsState()
    val listState = rememberScalingLazyListState()

    Box(modifier = Modifier.fillMaxSize()) {
        when {
            state.isLoading && state.games.isEmpty() -> {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator()
                }
            }
            state.games.isEmpty() -> {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text(
                        text = "No games yet",
                        style = MaterialTheme.typography.body1,
                        color = MaterialTheme.colors.onSurfaceVariant,
                        textAlign = TextAlign.Center,
                    )
                }
            }
            else -> {
                // Sort: suggested game first, then by time proximity
                val sortedGames = state.games.sortedWith(
                    compareBy<WearGameEntity> { it.id != state.suggestedGameId }
                        .thenBy { parseInstant(it.dateTime)?.let { t -> kotlin.math.abs(ChronoUnit.MINUTES.between(Instant.now(), t)) } ?: Long.MAX_VALUE }
                )

                ScalingLazyColumn(
                    state = listState,
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(
                        top = 32.dp,
                        bottom = 16.dp,
                        start = 8.dp,
                        end = 8.dp,
                    ),
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    // Header
                    item {
                        Text(
                            text = "Games",
                            style = MaterialTheme.typography.title3,
                            color = MaterialTheme.colors.primary,
                            modifier = Modifier.padding(bottom = 4.dp),
                        )
                    }

                    // Pending sync indicator
                    if (state.pendingSyncCount > 0) {
                        item {
                            Text(
                                text = "${state.pendingSyncCount} score(s) pending sync",
                                style = MaterialTheme.typography.caption3,
                                color = Warning,
                            )
                        }
                    }

                    // Offline indicator
                    if (state.isOffline) {
                        item {
                            Text(
                                text = "Offline — showing cached",
                                style = MaterialTheme.typography.caption3,
                                color = TextMuted,
                            )
                        }
                    }

                    items(sortedGames, key = { it.id }) { game ->
                        GameChip(
                            game = game,
                            isSuggested = game.id == state.suggestedGameId,
                            onClick = { onGameSelected(game.id) },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun GameChip(
    game: WearGameEntity,
    isSuggested: Boolean,
    onClick: () -> Unit,
) {
    val timeLabel = formatRelativeTime(game.dateTime)
    val chipColors = if (isSuggested) {
        ChipDefaults.chipColors(
            backgroundColor = MaterialTheme.colors.primary.copy(alpha = 0.2f),
        )
    } else {
        ChipDefaults.secondaryChipColors()
    }

    Chip(
        onClick = onClick,
        label = {
            Text(
                text = game.title,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        },
        secondaryLabel = {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (isSuggested) {
                    Text(
                        text = "NOW ",
                        style = MaterialTheme.typography.caption3,
                        color = Success,
                    )
                }
                Text(
                    text = timeLabel,
                    style = MaterialTheme.typography.caption3,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        },
        colors = chipColors,
        modifier = Modifier.fillMaxWidth(),
    )
}

private fun formatRelativeTime(dateTime: String): String {
    val instant = parseInstant(dateTime) ?: return dateTime
    val now = Instant.now()
    val minutes = ChronoUnit.MINUTES.between(now, instant)

    return when {
        minutes in -120..0 -> "In progress"
        minutes in 1..59 -> "In ${minutes}m"
        minutes in 60..1440 -> "In ${minutes / 60}h ${minutes % 60}m"
        minutes > 1440 -> {
            val zoned = instant.atZone(ZoneId.systemDefault())
            zoned.format(DateTimeFormatter.ofPattern("EEE HH:mm"))
        }
        minutes in -1440..-121 -> {
            val ago = kotlin.math.abs(minutes)
            "${ago / 60}h ago"
        }
        else -> {
            val zoned = instant.atZone(ZoneId.systemDefault())
            zoned.format(DateTimeFormatter.ofPattern("MMM d"))
        }
    }
}

private fun parseInstant(dateTime: String): Instant? = try {
    ZonedDateTime.parse(dateTime, DateTimeFormatter.ISO_DATE_TIME).toInstant()
} catch (_: Exception) {
    try { Instant.parse(dateTime) } catch (_: Exception) { null }
}
