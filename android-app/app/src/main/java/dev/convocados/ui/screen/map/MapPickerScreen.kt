package dev.convocados.ui.screen.map

import android.Manifest
import android.annotation.SuppressLint
import android.content.pm.PackageManager
import android.location.LocationManager
import android.view.MotionEvent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.MyLocation
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import dev.convocados.R
import dev.convocados.data.api.ConvocadosApi
import kotlinx.coroutines.launch
import org.osmdroid.config.Configuration
import org.osmdroid.tileprovider.tilesource.TileSourceFactory
import org.osmdroid.util.GeoPoint
import org.osmdroid.views.MapView
import org.osmdroid.views.overlay.Marker
import javax.inject.Inject

@HiltViewModel
class MapPickerViewModel @Inject constructor(private val api: ConvocadosApi) : ViewModel() {
    /**
     * Turn a dropped pin into a human place name. Failures return the formatted
     * coordinates so the field is never left blank.
     */
    suspend fun nameFor(latitude: Double, longitude: Double): String =
        runCatching { api.reversePlace(latitude, longitude).name }
            .getOrNull()
            ?.takeIf { it.isNotBlank() }
            ?: "%.5f, %.5f".format(latitude, longitude)
}

@SuppressLint("MissingPermission")
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MapPickerScreen(
    initialLat: Double = 38.7223,
    initialLng: Double = -9.1393,
    centerOnUserStart: Boolean = true,
    onLocationPicked: (lat: Double, lng: Double, name: String) -> Unit,
    onBack: () -> Unit,
    viewModel: MapPickerViewModel = hiltViewModel(),
) {
    val context = LocalContext.current
    var selectedLat by remember { mutableDoubleStateOf(initialLat) }
    var selectedLng by remember { mutableDoubleStateOf(initialLng) }
    // The map starts wherever the caller pointed it (or Lisbon), then jumps to
    // the user the moment we're allowed to know where they are.
    var centerLat by remember { mutableDoubleStateOf(initialLat) }
    var centerLng by remember { mutableDoubleStateOf(initialLng) }
    var mapViewRef by remember { mutableStateOf<MapView?>(null) }
    var markerRef by remember { mutableStateOf<Marker?>(null) }
    var resolving by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    fun currentLocation(center: Boolean) {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION)
            != PackageManager.PERMISSION_GRANTED
        ) return
        val lm = context.getSystemService(android.content.Context.LOCATION_SERVICE) as? LocationManager ?: return
        val loc = runCatching {
            lm.getLastKnownLocation(LocationManager.GPS_PROVIDER)
                ?: lm.getLastKnownLocation(LocationManager.NETWORK_PROVIDER)
        }.getOrNull() ?: return

        selectedLat = loc.latitude
        selectedLng = loc.longitude
        markerRef?.position = GeoPoint(loc.latitude, loc.longitude)
        if (center) {
            centerLat = loc.latitude
            centerLng = loc.longitude
            mapViewRef?.controller?.animateTo(GeoPoint(loc.latitude, loc.longitude))
        }
        mapViewRef?.invalidate()
    }

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        if (granted && centerOnUserStart) currentLocation(center = true)
    }

    // Ask for location up-front so the map opens near the user, as Maps does —
    // but only when the caller did not hand us a start point. "Pick on map"
    // from an already-chosen location must open exactly there, not jump away.
    LaunchedEffect(Unit) {
        Configuration.getInstance().userAgentValue = context.packageName
        val granted = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED
        if (granted) {
            if (centerOnUserStart) currentLocation(center = true)
        } else {
            permissionLauncher.launch(Manifest.permission.ACCESS_FINE_LOCATION)
        }
    }

    val scrollBehavior = TopAppBarDefaults.enterAlwaysScrollBehavior()
    Scaffold(
        modifier = Modifier.nestedScroll(scrollBehavior.nestedScrollConnection),
        topBar = {
            TopAppBar(scrollBehavior = scrollBehavior,
                title = { Text(stringResource(R.string.pick_location)) },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back)) } },
                actions = {
                    IconButton(
                        enabled = !resolving,
                        onClick = {
                            resolving = true
                            scope.launch {
                                val name = viewModel.nameFor(selectedLat, selectedLng)
                                resolving = false
                                onLocationPicked(selectedLat, selectedLng, name)
                            }
                        },
                    ) {
                        if (resolving) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                        else Icon(Icons.Default.Check, stringResource(R.string.confirm), tint = MaterialTheme.colorScheme.primary)
                    }
                },
            )
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            AndroidView(
                modifier = Modifier.fillMaxSize(),
                factory = { ctx ->
                    MapView(ctx).apply {
                        setTileSource(TileSourceFactory.MAPNIK)
                        setMultiTouchControls(true)
                        controller.setZoom(13.0)
                        controller.setCenter(GeoPoint(initialLat, initialLng))

                        val marker = Marker(this).apply {
                            position = GeoPoint(initialLat, initialLng)
                            setAnchor(Marker.ANCHOR_CENTER, Marker.ANCHOR_BOTTOM)
                            title = "Selected location"
                        }
                        overlays.add(marker)
                        markerRef = marker

                        overlays.add(object : org.osmdroid.views.overlay.Overlay() {
                            override fun onSingleTapConfirmed(e: MotionEvent?, mapView: MapView?): Boolean {
                                if (e == null || mapView == null) return false
                                val proj = mapView.projection
                                val geoPoint = proj.fromPixels(e.x.toInt(), e.y.toInt()) as GeoPoint
                                selectedLat = geoPoint.latitude
                                selectedLng = geoPoint.longitude
                                marker.position = geoPoint
                                mapView.invalidate()
                                return true
                            }
                        })
                        mapViewRef = this
                    }
                },
                update = { view ->
                    // Follow the user once their location lands.
                    view.controller.setCenter(GeoPoint(centerLat, centerLng))
                },
            )
            FloatingActionButton(
                onClick = { currentLocation(center = true) },
                modifier = Modifier.align(Alignment.TopEnd).padding(16.dp),
                containerColor = MaterialTheme.colorScheme.surfaceContainerHigh,
                contentColor = MaterialTheme.colorScheme.primary,
            ) {
                Icon(Icons.Default.MyLocation, stringResource(R.string.location_use_my_location))
            }
            Text(
                stringResource(R.string.tap_place_pin),
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.align(Alignment.BottomCenter)
                    .padding(16.dp)
                    .background(
                        MaterialTheme.colorScheme.surfaceContainerHigh,
                        MaterialTheme.shapes.small,
                    )
                    .padding(horizontal = 12.dp, vertical = 8.dp),
            )
        }
    }
}
