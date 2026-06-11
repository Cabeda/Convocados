package dev.convocados.ui.screen.map

import android.view.MotionEvent
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import dev.convocados.R
import org.osmdroid.config.Configuration
import org.osmdroid.tileprovider.tilesource.TileSourceFactory
import org.osmdroid.util.GeoPoint
import org.osmdroid.views.MapView
import org.osmdroid.views.overlay.Marker

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MapPickerScreen(
    initialLat: Double = 38.7223,
    initialLng: Double = -9.1393,
    onLocationPicked: (lat: Double, lng: Double) -> Unit,
    onBack: () -> Unit,
) {
    val context = LocalContext.current
    var selectedLat by remember { mutableDoubleStateOf(initialLat) }
    var selectedLng by remember { mutableDoubleStateOf(initialLng) }

    LaunchedEffect(Unit) {
        Configuration.getInstance().userAgentValue = context.packageName
    }

    val scrollBehavior = TopAppBarDefaults.enterAlwaysScrollBehavior()
    Scaffold(
        modifier = Modifier.nestedScroll(scrollBehavior.nestedScrollConnection),
        topBar = {
            TopAppBar(scrollBehavior = scrollBehavior, 
                title = { Text(stringResource(R.string.pick_location)) },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back)) } },
                actions = {
                    IconButton(onClick = { onLocationPicked(selectedLat, selectedLng) }) {
                        Icon(Icons.Default.Check, stringResource(R.string.confirm), tint = MaterialTheme.colorScheme.primary)
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
                    }
                },
            )
            Text(
                stringResource(R.string.tap_place_pin),
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.align(Alignment.BottomCenter).padding(16.dp),
            )
        }
    }
}
