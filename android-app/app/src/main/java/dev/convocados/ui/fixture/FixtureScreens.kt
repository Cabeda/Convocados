package dev.convocados.ui.fixture

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.SportsScore
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.convocados.R
import dev.convocados.data.api.EventDetail
import dev.convocados.data.api.EventSummary
import dev.convocados.data.api.UserProfile
import dev.convocados.ui.components.SectionCard
import dev.convocados.ui.screen.games.SportIcon
import dev.convocados.ui.theme.contentMaxWidthDp
import dev.convocados.ui.theme.layoutForWidthDp

/** Deterministic content surfaces used by previews and store-listing captures. */
@Composable
fun GamesFixtureContent(
    games: List<EventSummary>,
    onGameClick: (String) -> Unit,
    onCreateClick: () -> Unit,
) {
    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        floatingActionButton = {
            FloatingActionButton(
                onClick = onCreateClick,
                containerColor = MaterialTheme.colorScheme.primary,
                contentColor = MaterialTheme.colorScheme.onPrimary,
            ) {
                Icon(Icons.Default.Add, contentDescription = stringResource(R.string.create_game_button))
            }
        },
    ) { padding ->
        BoxWithConstraints(Modifier.fillMaxSize().padding(padding)) {
            val layout = layoutForWidthDp(maxWidth.value.toInt())
            LazyColumn(
                modifier = Modifier
                    .fillMaxWidth()
                    .widthIn(max = contentMaxWidthDp(layout).dp)
                    .align(Alignment.TopCenter),
                contentPadding = PaddingValues(horizontal = 16.dp, vertical = 20.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                item {
                    Text(
                        stringResource(R.string.my_games),
                        style = MaterialTheme.typography.headlineMedium,
                        color = MaterialTheme.colorScheme.onBackground,
                        fontWeight = FontWeight.Bold,
                    )
                    Text(
                        stringResource(R.string.games_you_host, games.size),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(top = 4.dp, bottom = 8.dp),
                    )
                }
                items(games, key = { it.id }) { game ->
                    FixtureGameCard(game = game, onClick = { onGameClick(game.id) })
                }
            }
        }
    }
}

@Composable
private fun FixtureGameCard(game: EventSummary, onClick: () -> Unit) {
    ElevatedCard(
        onClick = onClick,
        shape = MaterialTheme.shapes.large,
        colors = CardDefaults.elevatedCardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
        elevation = CardDefaults.elevatedCardElevation(defaultElevation = 2.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(18.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                SportIcon(game.sport, modifier = Modifier.size(28.dp))
                Spacer(Modifier.width(12.dp))
                Text(
                    game.title,
                    style = MaterialTheme.typography.titleLarge,
                    color = MaterialTheme.colorScheme.onSurface,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
            }
            Text(
                stringResource(R.string.event_meta, game.dateTime, game.playerCount, game.maxPlayers),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 10.dp),
            )
            if (game.location.isNotBlank()) {
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 8.dp)) {
                    Icon(Icons.Default.LocationOn, contentDescription = null, modifier = Modifier.size(16.dp), tint = MaterialTheme.colorScheme.primary)
                    Text(game.location, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline, modifier = Modifier.padding(start = 4.dp))
                }
            }
            if (game.lastScoreOne != null && game.lastScoreTwo != null) {
                Text(
                    stringResource(R.string.last_score, game.lastScoreOne, game.lastScoreTwo),
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.padding(top = 10.dp),
                )
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EventFixtureContent(
    event: EventDetail,
    onBack: () -> Unit,
    onPrimaryAction: () -> Unit,
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(event.title, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                navigationIcon = { IconButton(onClick = onBack) { Text("‹", style = MaterialTheme.typography.headlineLarge) } },
            )
        },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = padding.calculateTopPadding() + 12.dp, bottom = padding.calculateBottomPadding() + 24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item {
                SectionCard {
                    Text(event.title, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                    Text(event.dateTime, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(top = 8.dp))
                    if (event.location.isNotBlank()) {
                        Text(event.location, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp))
                    }
                    Button(onClick = onPrimaryAction, modifier = Modifier.fillMaxWidth().padding(top = 16.dp)) {
                        Text(stringResource(R.string.invite_view_game))
                    }
                }
            }
            item {
                Text(stringResource(R.string.players), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            }
            items(event.players, key = { it.id }) { player ->
                ListItem(
                    headlineContent = { Text(player.name) },
                    leadingContent = { Icon(Icons.Default.Person, contentDescription = null) },
                    colors = ListItemDefaults.colors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
                )
            }
        }
    }
}

@Composable
fun ProfileFixtureContent(
    user: UserProfile,
    onNotifications: () -> Unit,
    onSignOut: () -> Unit,
) {
    Column(
        Modifier
            .fillMaxSize()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(stringResource(R.string.profile), style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
        SectionCard {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.Person, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(32.dp))
                Column(Modifier.padding(start = 12.dp)) {
                    Text(user.name, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                    Text(user.email, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
        SectionCard(onClick = onNotifications) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.Notifications, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                Column(Modifier.padding(start = 12.dp)) {
                    Text(stringResource(R.string.notifications_title), style = MaterialTheme.typography.titleMedium)
                    Text(stringResource(R.string.notifications_subtitle), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
        OutlinedButton(onClick = onSignOut, modifier = Modifier.fillMaxWidth()) {
            Text(stringResource(R.string.sign_out))
        }
    }
}
