package dev.convocados.ui.screen.create

import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Casino
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.Place
import androidx.compose.material.icons.filled.SportsSoccer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import dev.convocados.R
import dev.convocados.data.api.ConvocadosApi
import dev.convocados.data.api.CreateEventRequest
import dev.convocados.data.api.PlaceSuggestion
import dev.convocados.data.api.UsualLocation
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import java.time.*
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale
import java.util.TimeZone
import javax.inject.Inject

data class SportPreset(val id: String, val label: String, val defaultMax: Int)

val SPORT_PRESETS = listOf(
    SportPreset("football-5v5", "Football 5v5", 10),
    SportPreset("football-7v7", "Football 7v7", 14),
    SportPreset("football-11v11", "Football 11v11", 22),
    SportPreset("futsal", "Futsal", 10),
    SportPreset("basketball", "Basketball", 10),
    SportPreset("volleyball", "Volleyball", 12),
    SportPreset("tennis-singles", "Tennis (singles)", 2),
    SportPreset("tennis-doubles", "Tennis (doubles)", 4),
    SportPreset("padel", "Padel", 4),
    SportPreset("badminton-singles", "Badminton (singles)", 2),
    SportPreset("badminton-doubles", "Badminton (doubles)", 4),
    SportPreset("squash", "Squash", 2),
    SportPreset("pickleball", "Pickleball", 4),
    SportPreset("other", "Other", 10),
)

/** #454 quick-adjust offsets for the date/time picker. 15/30-minute steps let the
 *  user set non-hour-aligned times (e.g. 18:30, 19:45) without going through
 *  the full TimePicker dialog. */
val TIME_QUICK_OFFSETS: List<Pair<Long, String>> = listOf(
    -86400L to "-1d",
    -3600L to "-1h",
    -1800L to "-30m",
    -900L to "-15m",
    900L to "+15m",
    1800L to "+30m",
    3600L to "+1h",
    86400L to "+1d",
)

@HiltViewModel
class CreateEventViewModel @Inject constructor(private val api: ConvocadosApi) : ViewModel() {
    private val _creating = MutableStateFlow(false)
    val creating: StateFlow<Boolean> = _creating
    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error

    // Venues the user already plays at — offered as defaults before they type.
    private val _usualLocations = MutableStateFlow<List<UsualLocation>>(emptyList())
    val usualLocations: StateFlow<List<UsualLocation>> = _usualLocations

    init {
        viewModelScope.launch {
            _usualLocations.value = runCatching { api.fetchMyLocations().locations }.getOrDefault(emptyList())
        }
    }

    fun create(
        title: String, location: String, dateTime: Instant, sport: String,
        maxPlayers: Int, teamOneName: String, teamTwoName: String,
        isRecurring: Boolean, recurrenceFreq: String?,
        latitude: Double? = null, longitude: Double? = null,
        onSuccess: (String) -> Unit,
    ) {
        viewModelScope.launch {
            _creating.value = true
            _error.value = null
            runCatching {
                api.createEvent(CreateEventRequest(
                    title = title, location = location.ifBlank { null },
                    dateTime = dateTime.toString(),
                    timezone = TimeZone.getDefault().id,
                    maxPlayers = maxPlayers, sport = sport,
                    teamOneName = teamOneName.ifBlank { null },
                    teamTwoName = teamTwoName.ifBlank { null },
                    isRecurring = isRecurring,
                    recurrenceFreq = if (isRecurring) recurrenceFreq else null,
                    recurrenceInterval = if (isRecurring) 1 else null,
                    latitude = latitude,
                    longitude = longitude,
                ))
            }.onSuccess { onSuccess(it.id) }
                .onFailure { _error.value = it.message }
            _creating.value = false
        }
    }

    /** Location autocomplete. Failures degrade to "no suggestions", never an error. */
    suspend fun searchPlaces(query: String, latitude: Double? = null, longitude: Double? = null): List<PlaceSuggestion> =
        runCatching { api.searchPlaces(query, latitude, longitude).suggestions }.getOrDefault(emptyList())
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CreateEventScreen(
    onCreated: (String) -> Unit,
    onBack: () -> Unit,
    onPickMap: (lat: Double?, lng: Double?) -> Unit = { _, _ -> },
    pickedLat: Double? = null,
    pickedLng: Double? = null,
    pickedPlaceName: String? = null,
    viewModel: CreateEventViewModel = hiltViewModel(),
) {
    val creating by viewModel.creating.collectAsState()
    val error by viewModel.error.collectAsState()
    val usualLocations by viewModel.usualLocations.collectAsState()

    // Parity with web CreateEventForm: seed a random fun title on open and
    // let the dice button (Casino icon) reroll it.
    val titleLocale = remember { RandomTitles.resolveSupportedLocale(Locale.getDefault()) }
    var title by remember { mutableStateOf(RandomTitles.getRandomTitle(titleLocale)) }
    var location by remember { mutableStateOf("") }
    // Coordinates from the map picker (if the user chose a pin) travel with the
    // create request so the game is geocoded exactly where it was dropped.
    var latitude by remember(pickedLat) { mutableStateOf(pickedLat) }
    var longitude by remember(pickedLng) { mutableStateOf(pickedLng) }
    // Name of an autocompleted pick — used to avoid re-searching our own text.
    var pickedName by remember(pickedPlaceName) { mutableStateOf(pickedPlaceName) }
    // A pin dropped on the map writes its reverse-geocoded name into the box.
    LaunchedEffect(pickedPlaceName, pickedLat, pickedLng) {
        if (pickedPlaceName != null && pickedLat != null && pickedLng != null) {
            location = pickedPlaceName
            pickedName = pickedPlaceName
        }
    }
    // #454: keep the current minutes/seconds — don't snap to the top of the hour.
    // The user must be able to pick 18:30, 19:45, etc.
    var dateTime by remember { mutableStateOf(Instant.now().plusSeconds(3600)) }
    var sport by remember { mutableStateOf("football-5v5") }
    var maxPlayers by remember { mutableStateOf("10") }
    var showAdvanced by remember { mutableStateOf(false) }
    var teamOneName by remember { mutableStateOf("Ninjas") }
    var teamTwoName by remember { mutableStateOf("Gunas") }
    var isRecurring by remember { mutableStateOf(false) }
    var recurrenceFreq by remember { mutableStateOf("weekly") }

    // Best-effort location bias for autocomplete, so "campo" offers the pitch
    // down the road before one in Brazil. Asking is deliberate: without it,
    // search results are global and feel wrong. Denial degrades to no bias.
    val context = androidx.compose.ui.platform.LocalContext.current
    var biasLat by remember { mutableStateOf<Double?>(null) }
    var biasLng by remember { mutableStateOf<Double?>(null) }

    fun readLastKnownLocation() {
        val lm = context.getSystemService(android.content.Context.LOCATION_SERVICE) as? android.location.LocationManager
            ?: return
        val loc = runCatching {
            lm.getLastKnownLocation(android.location.LocationManager.NETWORK_PROVIDER)
                ?: lm.getLastKnownLocation(android.location.LocationManager.GPS_PROVIDER)
        }.getOrNull() ?: return
        biasLat = loc.latitude
        biasLng = loc.longitude
    }

    fun hasLocationPermission(): Boolean =
        androidx.core.content.ContextCompat.checkSelfPermission(
            context, android.Manifest.permission.ACCESS_FINE_LOCATION,
        ) == android.content.pm.PackageManager.PERMISSION_GRANTED ||
            androidx.core.content.ContextCompat.checkSelfPermission(
                context, android.Manifest.permission.ACCESS_COARSE_LOCATION,
            ) == android.content.pm.PackageManager.PERMISSION_GRANTED

    val locationPermissionLauncher = androidx.activity.compose.rememberLauncherForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.RequestPermission(),
    ) { granted -> if (granted) readLastKnownLocation() }

    LaunchedEffect(Unit) {
        if (hasLocationPermission()) readLastKnownLocation()
        else locationPermissionLauncher.launch(android.Manifest.permission.ACCESS_COARSE_LOCATION)
    }

    val scrollBehavior = TopAppBarDefaults.enterAlwaysScrollBehavior()
    Scaffold(
        modifier = Modifier.nestedScroll(scrollBehavior.nestedScrollConnection),
        topBar = {
            TopAppBar(scrollBehavior = scrollBehavior, 
                title = { Text(stringResource(R.string.create_game)) },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back)) } },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background),
            )
        },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        Column(
            modifier = Modifier.padding(padding).verticalScroll(rememberScrollState()).padding(16.dp),
        ) {
            error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(bottom = 12.dp)) }

            Label(stringResource(R.string.game_title))
            OutlinedTextField(
                value = title, onValueChange = { title = it },
                placeholder = { Text(stringResource(R.string.game_title_placeholder)) },
                trailingIcon = {
                    IconButton(onClick = { title = RandomTitles.getRandomTitle(titleLocale) }) {
                        Icon(
                            Icons.Filled.Casino,
                            contentDescription = stringResource(R.string.randomize_title),
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                },
                modifier = Modifier.fillMaxWidth(), singleLine = true,
                colors = textFieldColors(),
            )

            Label(stringResource(R.string.sport))
            Row(modifier = Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                SPORT_PRESETS.forEach { s ->
                    FilterChip(
                        selected = sport == s.id,
                        onClick = { sport = s.id; maxPlayers = s.defaultMax.toString() },
                        label = { Text(s.label) },
                        colors = FilterChipDefaults.filterChipColors(
                            selectedContainerColor = MaterialTheme.colorScheme.primaryContainer, selectedLabelColor = MaterialTheme.colorScheme.onPrimaryContainer,
                        ),
                    )
                }
            }

            Label(stringResource(R.string.location_optional))
            LocationAutocompleteField(
                value = location,
                onValueChange = { text ->
                    location = text
                    // Typing freely invalidates a previously selected place.
                    if (pickedName != null && text != pickedName) {
                        latitude = null
                        longitude = null
                        pickedName = null
                    }
                },
                onPick = { suggestion ->
                    location = suggestion.name
                    latitude = suggestion.latitude
                    longitude = suggestion.longitude
                    pickedName = suggestion.name
                },
                pickedName = pickedName,
                defaults = usualLocations,
                onPickDefault = { venue ->
                    location = venue.location
                    pickedName = venue.location
                    latitude = venue.latitude
                    longitude = venue.longitude
                },
                // Bias autocomplete toward the user's area so their local
                // pitches outrank similar-sounding places elsewhere.
                search = { q -> viewModel.searchPlaces(q, biasLat, biasLng) },
            )
            TextButton(onClick = { onPickMap(latitude, longitude) }) { Text(stringResource(R.string.pick_on_map), color = MaterialTheme.colorScheme.primary) }
            if (latitude != null && longitude != null) {
                Text(
                    stringResource(R.string.location_pinned),
                    color = MaterialTheme.colorScheme.primary,
                    style = MaterialTheme.typography.labelSmall,
                )
            }

            Label(stringResource(R.string.date_time))
            // #454: tap the displayed time to open a Material 3 TimePicker dialog
            // for precise hour/minute selection (18:30, 19:45, etc).
            var showTimePicker by remember { mutableStateOf(false) }
            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface), modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.padding(14.dp), horizontalAlignment = androidx.compose.ui.Alignment.CenterHorizontally) {
                    val fmt = DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT).withZone(ZoneId.systemDefault())
                    TextButton(onClick = { showTimePicker = true }) {
                        Text(fmt.format(dateTime), color = MaterialTheme.colorScheme.onSurface, style = MaterialTheme.typography.titleMedium)
                    }
                    Spacer(Modifier.height(6.dp))
                    // #454: 15/30-minute quick adjustments so the user can fine-tune
                    // without going through the TimePicker dialog.
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState())) {
                        TIME_QUICK_OFFSETS.forEach { (secs, label) ->
                            FilledTonalButton(onClick = { dateTime = dateTime.plusSeconds(secs) }) { Text(label) }
                        }
                    }
                }
            }

            if (showTimePicker) {
                val zone = ZoneId.systemDefault()
                val current = dateTime.atZone(zone)
                val timePickerState = rememberTimePickerState(
                    initialHour = current.hour,
                    initialMinute = current.minute,
                    is24Hour = true,
                )
                AlertDialog(
                    onDismissRequest = { showTimePicker = false },
                    confirmButton = {
                        TextButton(onClick = {
                            val newDateTime = current
                                .withHour(timePickerState.hour)
                                .withMinute(timePickerState.minute)
                                .withSecond(0)
                                .withNano(0)
                                .toInstant()
                            dateTime = newDateTime
                            showTimePicker = false
                        }) { Text(stringResource(android.R.string.ok)) }
                    },
                    dismissButton = {
                        TextButton(onClick = { showTimePicker = false }) { Text(stringResource(android.R.string.cancel)) }
                    },
                    title = { Text(stringResource(R.string.date_time)) },
                    text = { TimePicker(state = timePickerState) },
                )
            }

            Label(stringResource(R.string.max_players))
            OutlinedTextField(
                value = maxPlayers, onValueChange = { maxPlayers = it.filter { c -> c.isDigit() } },
                modifier = Modifier.width(100.dp), singleLine = true,
                colors = textFieldColors(),
            )
            Text(stringResource(R.string.max_players_hint), color = MaterialTheme.colorScheme.outline, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 4.dp))

            TextButton(onClick = { showAdvanced = !showAdvanced }, modifier = Modifier.padding(top = 16.dp)) {
                Text("${if (showAdvanced) "▼" else "▶"} ${stringResource(R.string.advanced_options)}", color = MaterialTheme.colorScheme.outline)
            }

            if (showAdvanced) {
                Label(stringResource(R.string.team_1_name))
                OutlinedTextField(value = teamOneName, onValueChange = { teamOneName = it }, modifier = Modifier.fillMaxWidth(), singleLine = true, colors = textFieldColors())
                Label(stringResource(R.string.team_2_name))
                OutlinedTextField(value = teamTwoName, onValueChange = { teamTwoName = it }, modifier = Modifier.fillMaxWidth(), singleLine = true, colors = textFieldColors())

                Row(modifier = Modifier.padding(top = 16.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                    Text(stringResource(R.string.recurring_game), color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
                    Switch(checked = isRecurring, onCheckedChange = { isRecurring = it }, colors = SwitchDefaults.colors(checkedThumbColor = MaterialTheme.colorScheme.primary, checkedTrackColor = MaterialTheme.colorScheme.primaryContainer))
                }
                if (isRecurring) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 8.dp)) {
                        listOf("weekly", "monthly").forEach { f ->
                            FilterChip(
                                selected = recurrenceFreq == f, onClick = { recurrenceFreq = f },
                                label = { Text(f.replaceFirstChar { it.uppercase() }) },
                                colors = FilterChipDefaults.filterChipColors(selectedContainerColor = MaterialTheme.colorScheme.primaryContainer, selectedLabelColor = MaterialTheme.colorScheme.onPrimaryContainer),
                            )
                        }
                    }
                }
            }

            Spacer(Modifier.height(24.dp))
            Button(
                onClick = {
                    val mp = maxPlayers.toIntOrNull() ?: 10
                    viewModel.create(
                        title.trim(), location.trim(), dateTime, sport, mp,
                        teamOneName.trim(), teamTwoName.trim(), isRecurring, recurrenceFreq,
                        latitude = latitude, longitude = longitude,
                        onSuccess = onCreated,
                    )
                },
                enabled = title.isNotBlank() && !creating,
                modifier = Modifier.fillMaxWidth().height(52.dp),
                colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primary),
                shape = MaterialTheme.shapes.medium,
            ) {
                if (creating) CircularProgressIndicator(color = MaterialTheme.colorScheme.onPrimary, modifier = Modifier.size(20.dp))
                else Text(stringResource(R.string.create_game_button), color = MaterialTheme.colorScheme.onPrimary, style = MaterialTheme.typography.titleMedium)
            }
            Spacer(Modifier.height(40.dp))
        }
    }
}

@Composable
private fun Label(text: String) {
    Text(text, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(top = 16.dp, bottom = 6.dp))
}

@Composable
private fun textFieldColors() = OutlinedTextFieldDefaults.colors(
    focusedTextColor = MaterialTheme.colorScheme.onSurface, unfocusedTextColor = MaterialTheme.colorScheme.onSurface,
    focusedBorderColor = MaterialTheme.colorScheme.primary, unfocusedBorderColor = MaterialTheme.colorScheme.outlineVariant,
    cursorColor = MaterialTheme.colorScheme.primary,
    focusedPlaceholderColor = MaterialTheme.colorScheme.outline, unfocusedPlaceholderColor = MaterialTheme.colorScheme.outline,
    // Material 3 outlined fields sit on the surface, not on a filled slab —
    // the old surfaceVariant fill is what made the form read as boxy.
    focusedContainerColor = androidx.compose.ui.graphics.Color.Transparent,
    unfocusedContainerColor = androidx.compose.ui.graphics.Color.Transparent,
)

/**
 * Location field with Google-Maps-style autocomplete.
 *
 * Suggestions come from `/api/places`, which ranks sports facilities
 * (pitches, courts, sports centres) ahead of unrelated places, so typing
 * "areosa" offers the pitch before the restaurant. Picking a suggestion writes
 * its bare name into the field and hands the exact coordinates to the caller.
 */
@Composable
private fun LocationAutocompleteField(
    value: String,
    onValueChange: (String) -> Unit,
    onPick: (PlaceSuggestion) -> Unit,
    pickedName: String? = null,
    defaults: List<UsualLocation> = emptyList(),
    onPickDefault: (UsualLocation) -> Unit = {},
    search: suspend (String) -> List<PlaceSuggestion> = { emptyList() },
    modifier: Modifier = Modifier,
) {
    var suggestions by remember { mutableStateOf<List<PlaceSuggestion>>(emptyList()) }
    var loading by remember { mutableStateOf(false) }
    var open by remember { mutableStateOf(false) }

    // Debounced search: wait for a typing pause before hitting the proxy, which
    // keeps us well inside Photon's usage policy. A value that came from a pick
    // is not re-searched — otherwise choosing "Campo da Areosa" would reopen
    // the dropdown listing other places of the same name.
    LaunchedEffect(value) {
        val query = value.trim()
        if (query.length < 2 || query == pickedName) {
            suggestions = emptyList()
            open = false
            return@LaunchedEffect
        }
        delay(300)
        loading = true
        val results = search(query)
        loading = false
        suggestions = results
        open = results.isNotEmpty()
    }

    Column(modifier = modifier) {
        OutlinedTextField(
            value = value,
            onValueChange = { onValueChange(it); open = true },
            placeholder = { Text(stringResource(R.string.location_placeholder)) },
            leadingIcon = { Icon(Icons.Filled.LocationOn, null, tint = MaterialTheme.colorScheme.onSurfaceVariant) },
            trailingIcon = {
                if (loading) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
            },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            shape = MaterialTheme.shapes.medium,
            colors = textFieldColors(),
        )

        // Default recommendations: the venues this user already plays at, so
        // the common case is one tap without typing or opening the map.
        if (value.isBlank() && defaults.isNotEmpty() && suggestions.isEmpty()) {
            Text(
                stringResource(R.string.location_usual_venues),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 8.dp, bottom = 2.dp),
            )
            Row(
                modifier = Modifier.horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                defaults.forEach { venue ->
                    AssistChip(
                        onClick = { onPickDefault(venue) },
                        label = { Text(venue.location) },
                        leadingIcon = {
                            Icon(Icons.Filled.Place, null, Modifier.size(16.dp), tint = MaterialTheme.colorScheme.primary)
                        },
                    )
                }
            }
        }

        if (open && suggestions.isNotEmpty()) {
            // A plain elevated card reads as a dropdown without fighting the
            // scrolling parent the way a nested ExposedDropdownMenuBox would.
            Card(
                modifier = Modifier.fillMaxWidth().padding(top = 4.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerHigh),
                shape = MaterialTheme.shapes.medium,
            ) {
                Column {
                    suggestions.forEach { s ->
                        ListItem(
                            headlineContent = { Text(s.label, maxLines = 1) },
                            leadingContent = {
                                Icon(
                                    // Sports venues get a distinct, primary-tinted icon
                                    // so the "court first" ranking is visible at a glance.
                                    if (s.isSport) Icons.Filled.SportsSoccer else Icons.Filled.Place,
                                    contentDescription = null,
                                    tint = if (s.isSport) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            },
                            colors = ListItemDefaults.colors(containerColor = androidx.compose.ui.graphics.Color.Transparent),
                            modifier = Modifier.clickable {
                                onPick(s)
                                open = false
                            },
                        )
                    }
                }
            }
        }
    }
}
