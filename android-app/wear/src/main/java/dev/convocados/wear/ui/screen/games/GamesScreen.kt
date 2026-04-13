package dev.convocados.wear.ui.screen.games

import androidx.compose.foundation.layout.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.material3.*
import com.google.android.horologist.annotations.ExperimentalHorologistApi
import com.google.android.horologist.compose.layout.ScalingLazyColumn
import com.google.android.horologist.compose.layout.ScalingLazyColumnDefaults
import com.google.android.horologist.compose.layout.ScreenScaffold
import com.google.android.horologist.compose.layout.rememberColumnState
import dev.convocados.wear.data.local.entity.WearGameEntity
import dev.convocados.wear.ui.theme.Success
import dev.convocados.wear.ui.theme.TextMuted
import dev.convocados.wear.ui.theme.Warning
import java.time.Instant
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit

@OptIn(ExperimentalHorologistApi::class)
@Composable
fun GamesScreen(
    viewModel: GamesViewModel,
    onGameSelected: (String) -> Unit,
) {
    val state by viewModel.uiState.collectAsState()
    val columnState = rememberColumnState(
        ScalingLazyColumnDefaults.responsive()
    )

    val sortedGames = remember(state.games, state.suggestedGameId) {
        state.games.sortedWith(
            compareBy<WearGameEntity> { it.id != state.suggestedGameId }
                .thenBy { parseInstant(it.dateTime)?.let { t -> kotlin.math.abs(ChronoUnit.MINUTES.between(Instant.now(), t)) } ?: Long.MAX_VALUE }
        )
    }

    ScreenScaffold(scrollState = columnState) {
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
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = TextAlign.Center,
                    )
                }
            }
            else -> {
                ScalingLazyColumn(
                    columnState = columnState,
                    modifier = Modifier.fillMaxSize(),
                ) {
                    item {
                        ListHeader {
                            Text(
                                text = "Games",
                                style = MaterialTheme.typography.titleMedium,
                                color = MaterialTheme.colorScheme.primary,
                            )
                        }
                    }

                    if (state.pendingSyncCount > 0) {
                        item {
                            Text(
                                text = "${state.pendingSyncCount} score(s) pending sync",
                                style = MaterialTheme.typography.labelSmall,
                                color = Warning,
                                modifier = Modifier.fillMaxWidth(),
                                textAlign = TextAlign.Center
                            )
                        }
                    }

                    if (state.isOffline) {
                        item {
                            Text(
                                text = "Offline — showing cached",
                                style = MaterialTheme.typography.labelSmall,
                                color = TextMuted,
                                modifier = Modifier.fillMaxWidth(),
                                textAlign = TextAlign.Center
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
    
    Button(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
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
                        style = MaterialTheme.typography.labelSmall,
                        color = Success,
                    )
                }
                Text(
                    text = timeLabel,
                    style = MaterialTheme.typography.labelSmall,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        },
        colors = if (isSuggested) {
            ButtonDefaults.buttonColors(
                containerColor = MaterialTheme.colorScheme.primaryContainer,
            )
        } else {
            ButtonDefaults.filledTonalButtonColors()
        }
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
