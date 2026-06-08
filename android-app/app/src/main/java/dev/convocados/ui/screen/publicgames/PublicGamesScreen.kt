package dev.convocados.ui.screen.publicgames

import android.view.MotionEvent
import androidx.compose.animation.AnimatedVisibilityScope
import androidx.compose.animation.ExperimentalSharedTransitionApi
import androidx.compose.animation.SharedTransitionScope
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Map
import androidx.compose.material.icons.filled.ViewList
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.convocados.R
import androidx.compose.ui.viewinterop.AndroidView
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import dev.convocados.data.api.ConvocadosApi
import dev.convocados.data.api.PublicEvent
import dev.convocados.ui.screen.games.formatRelativeDate
import dev.convocados.ui.screen.games.sportEmoji
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import org.osmdroid.config.Configuration
import org.osmdroid.tileprovider.tilesource.TileSourceFactory
import org.osmdroid.util.GeoPoint
import org.osmdroid.views.MapView
import org.osmdroid.views.overlay.Marker
import javax.inject.Inject

val SPORT_FILTERS = listOf("all", "football", "futsal", "basketball", "volleyball", "tennis", "padel")

@HiltViewModel
class PublicGamesViewModel @Inject constructor(private val api: ConvocadosApi) : ViewModel() {
    private val _events = MutableStateFlow<List<PublicEvent>>(emptyList())
    val events: StateFlow<List<PublicEvent>> = _events
    private val _loading = MutableStateFlow(true)
    val loading: StateFlow<Boolean> = _loading
    private val _hasMore = MutableStateFlow(false)
    val hasMore: StateFlow<Boolean> = _hasMore
    private val _sportFilter = MutableStateFlow("all")
    val sportFilter: StateFlow<String> = _sportFilter
    private var cursor: String? = null
    private var allEvents: List<PublicEvent> = emptyList()

    init { load() }

    fun load() {
        viewModelScope.launch {
            _loading.value = true
            runCatching { api.fetchPublicEvents() }.onSuccess {
                allEvents = it.data; _hasMore.value = it.hasMore; cursor = it.nextCursor
                applyFilter()
            }
            _loading.value = false
        }
    }

    fun loadMore() {
        val c = cursor ?: return
        viewModelScope.launch {
            runCatching { api.fetchPublicEvents(c) }.onSuccess {
                allEvents = allEvents + it.data; _hasMore.value = it.hasMore; cursor = it.nextCursor
                applyFilter()
            }
        }
    }

    fun setSportFilter(sport: String) {
        _sportFilter.value = sport
        applyFilter()
    }

    private fun applyFilter() {
        _events.value = if (_sportFilter.value == "all") allEvents
        else allEvents.filter { it.sport.contains(_sportFilter.value, ignoreCase = true) }
    }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalSharedTransitionApi::class)
@Composable
fun PublicGamesScreen(
    onEventClick: (String) -> Unit,
    onBack: () -> Unit,
    viewModel: PublicGamesViewModel = hiltViewModel(),
    sharedTransitionScope: SharedTransitionScope,
    animatedVisibilityScope: AnimatedVisibilityScope,
) {
    val events by viewModel.events.collectAsState()
    val loading by viewModel.loading.collectAsState()
    val hasMore by viewModel.hasMore.collectAsState()
    val sportFilter by viewModel.sportFilter.collectAsState()
    var showMap by remember { mutableStateOf(false) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("\uD83C\uDF0D ${stringResource(R.string.public_games)}") },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back)) } },
                actions = {
                    IconButton(onClick = { showMap = !showMap }) {
                        Icon(if (showMap) Icons.Default.ViewList else Icons.Default.Map, "Toggle view")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background),
            )
        },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        if (loading) { Box(Modifier.fillMaxSize().padding(padding), Alignment.Center) { CircularProgressIndicator(color = MaterialTheme.colorScheme.primary) }; return@Scaffold }

        Column(Modifier.fillMaxSize().padding(padding)) {
            // Sport filter chips
            Row(
                modifier = Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                SPORT_FILTERS.forEach { sport ->
                    FilterChip(
                        selected = sportFilter == sport,
                        onClick = { viewModel.setSportFilter(sport) },
                        label = { Text(if (sport == "all") "All" else sport.replaceFirstChar { it.uppercase() }) },
                        colors = FilterChipDefaults.filterChipColors(
                            selectedContainerColor = MaterialTheme.colorScheme.primaryContainer,
                            selectedLabelColor = MaterialTheme.colorScheme.onPrimaryContainer,
                        ),
                    )
                }
            }

            if (showMap) {
                PublicGamesMapView(events = events, onEventClick = onEventClick)
            } else {
                LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (events.isEmpty()) {
                        item {
                            Column(Modifier.fillMaxWidth().padding(48.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                                Text("🌍", fontSize = 40.sp)
                                Spacer(Modifier.height(8.dp))
                                Text("No public games right now", style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurface)
                                Text("Create a game and make it public so others can find it.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
                            }
                        }
                    }
                    items(events, key = { it.id }) { event ->
                        Card(
                            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable { onEventClick(event.id) }
                                .then(
                                    with(sharedTransitionScope) {
                                        Modifier.sharedElement(
                                            rememberSharedContentState(key = "item-container-${event.id}"),
                                            animatedVisibilityScope = animatedVisibilityScope
                                        )
                                    }
                                )
                        ) {
                            Column(Modifier.padding(16.dp)) {
                                Row(horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
                                    Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically) {
                                        Text(sportEmoji(event.sport), fontSize = 18.sp, modifier = Modifier.padding(end = 8.dp))
                                        Text(event.title, color = MaterialTheme.colorScheme.onSurface, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                                    }
                                    Card(colors = CardDefaults.cardColors(containerColor = if (event.spotsLeft == 0) MaterialTheme.colorScheme.errorContainer else MaterialTheme.colorScheme.primaryContainer)) {
                                        Text(if (event.spotsLeft == 0) "Full" else "${event.spotsLeft} spots", color = if (event.spotsLeft == 0) MaterialTheme.colorScheme.onErrorContainer else MaterialTheme.colorScheme.onPrimaryContainer, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp))
                                    }
                                }
                                Text("${formatRelativeDate(event.dateTime)} · ${event.playerCount}/${event.maxPlayers} players", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp)
                                if (event.location.isNotBlank()) Text("\uD83D\uDCCD ${event.location}", color = MaterialTheme.colorScheme.outline, fontSize = 12.sp, maxLines = 1, modifier = Modifier.padding(top = 4.dp))
                            }
                        }
                    }
                    if (hasMore) {
                        item { TextButton(onClick = { viewModel.loadMore() }, modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.load_more), color = MaterialTheme.colorScheme.primary) } }
                    }
                }
            }
        }
    }
}

@Composable
private fun PublicGamesMapView(events: List<PublicEvent>, onEventClick: (String) -> Unit) {
    val context = LocalContext.current
    val geoEvents = events.filter { it.latitude != null && it.longitude != null }

    LaunchedEffect(Unit) {
        Configuration.getInstance().userAgentValue = context.packageName
    }

    if (geoEvents.isEmpty()) {
        Box(Modifier.fillMaxSize(), Alignment.Center) {
            Text("No events with location data", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.outline)
        }
        return
    }

    AndroidView(
        modifier = Modifier.fillMaxSize(),
        factory = { ctx ->
            MapView(ctx).apply {
                setTileSource(TileSourceFactory.MAPNIK)
                setMultiTouchControls(true)
                controller.setZoom(10.0)
                val first = geoEvents.first()
                controller.setCenter(GeoPoint(first.latitude!!, first.longitude!!))
            }
        },
        update = { mapView ->
            mapView.overlays.clear()
            geoEvents.forEach { event ->
                val marker = Marker(mapView).apply {
                    position = GeoPoint(event.latitude!!, event.longitude!!)
                    setAnchor(Marker.ANCHOR_CENTER, Marker.ANCHOR_BOTTOM)
                    title = event.title
                    snippet = "${event.playerCount}/${event.maxPlayers} players"
                    setOnMarkerClickListener { _, _ ->
                        onEventClick(event.id)
                        true
                    }
                }
                mapView.overlays.add(marker)
            }
            mapView.invalidate()
        },
    )
}
