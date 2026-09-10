package dev.convocados.ui.screen.profile

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import dev.convocados.R
import dev.convocados.util.ProfilePhoto
import kotlin.math.max
import kotlin.math.roundToInt

/** Largest edge we decode, to keep cropping responsive on huge camera photos. */
private const val MAX_INPUT_DIMENSION = 2048

/** Downsample factor so the decoded bitmap's longest edge is <= [maxDimension]. */
internal fun sampleSize(width: Int, height: Int, maxDimension: Int = MAX_INPUT_DIMENSION): Int {
    if (width <= 0 || height <= 0) return 1
    var sample = 1
    val longest = max(width, height)
    while (longest / sample > maxDimension) sample *= 2
    return sample
}

private fun loadScaledBitmap(context: Context, uri: Uri): Bitmap? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
    val options = BitmapFactory.Options().apply {
        inSampleSize = sampleSize(bounds.outWidth, bounds.outHeight)
    }
    return context.contentResolver.openInputStream(uri)?.use {
        BitmapFactory.decodeStream(it, null, options)
    }
}

/**
 * Full-screen square cropper: pinch/drag to frame, slider to zoom, then confirm
 * to return the cropped [Bitmap].
 */
@Composable
fun ProfilePhotoCropScreen(
    imageUri: Uri,
    onCancel: () -> Unit,
    onConfirm: (Bitmap) -> Unit,
) {
    val context = LocalContext.current
    val density = LocalDensity.current

    var bitmap by remember(imageUri) { mutableStateOf<Bitmap?>(null) }
    var loadFailed by remember(imageUri) { mutableStateOf(false) }
    var zoom by remember(imageUri) { mutableFloatStateOf(ProfilePhoto.MIN_ZOOM) }
    var offset by remember(imageUri) { mutableStateOf(Offset.Zero) }
    var viewportPx by remember(imageUri) { mutableIntStateOf(0) }

    LaunchedEffect(imageUri) {
        val loaded = runCatching { loadScaledBitmap(context, imageUri) }.getOrNull()
        bitmap = loaded
        loadFailed = loaded == null
    }

    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Column(
            Modifier
                .fillMaxSize()
                .windowInsetsPadding(WindowInsets.safeDrawing)
                .padding(16.dp),
        ) {
            Text(
                stringResource(R.string.profile_photo),
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.padding(bottom = 12.dp),
            )

            Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                if (loadFailed) {
                    Text(stringResource(R.string.photo_load_error), color = MaterialTheme.colorScheme.error)
                } else {
                    BoxWithConstraints(
                        Modifier
                            .fillMaxWidth()
                            .aspectRatio(1f)
                            .clip(RoundedCornerShape(16.dp))
                            .background(Color.Black),
                    ) {
                        val viewport = constraints.maxWidth
                        SideEffect { viewportPx = viewport }
                        val b = bitmap
                        if (b == null) {
                            CircularProgressIndicator(Modifier.align(Alignment.Center))
                        } else {
                            Canvas(
                                Modifier
                                    .fillMaxSize()
                                    .pointerInput(b, viewport) {
                                        detectTransformGestures { _, pan, gestureZoom, _ ->
                                            val base = ProfilePhoto.coverScale(b.width, b.height, viewport)
                                            val nextZoom = (zoom * gestureZoom)
                                                .coerceIn(ProfilePhoto.MIN_ZOOM, ProfilePhoto.MAX_ZOOM)
                                            val effective = base * nextZoom
                                            zoom = nextZoom
                                            offset = Offset(
                                                ProfilePhoto.clampOffset(offset.x + pan.x, b.width * effective, viewport),
                                                ProfilePhoto.clampOffset(offset.y + pan.y, b.height * effective, viewport),
                                            )
                                        }
                                    },
                            ) {
                                val base = ProfilePhoto.coverScale(b.width, b.height, viewport)
                                val effective = base * zoom
                                val displayedWidth = b.width * effective
                                val displayedHeight = b.height * effective
                                val left = size.width / 2f - displayedWidth / 2f + offset.x
                                val top = size.height / 2f - displayedHeight / 2f + offset.y
                                drawImage(
                                    b.asImageBitmap(),
                                    dstOffset = IntOffset(left.roundToInt(), top.roundToInt()),
                                    dstSize = IntSize(displayedWidth.roundToInt(), displayedHeight.roundToInt()),
                                )
                                drawCircle(
                                    color = Color.White.copy(alpha = 0.6f),
                                    radius = size.minDimension / 2f - 4.dp.toPx(),
                                    style = Stroke(width = 2.dp.toPx()),
                                )
                            }
                        }
                    }
                }
            }

            Row(
                Modifier.fillMaxWidth().padding(top = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(stringResource(R.string.zoom), style = MaterialTheme.typography.labelLarge)
                Slider(
                    value = zoom,
                    onValueChange = { value ->
                        zoom = value
                        val b = bitmap
                        if (b != null && viewportPx > 0) {
                            val effective = ProfilePhoto.coverScale(b.width, b.height, viewportPx) * value
                            offset = Offset(
                                ProfilePhoto.clampOffset(offset.x, b.width * effective, viewportPx),
                                ProfilePhoto.clampOffset(offset.y, b.height * effective, viewportPx),
                            )
                        }
                    },
                    valueRange = ProfilePhoto.MIN_ZOOM..ProfilePhoto.MAX_ZOOM,
                    modifier = Modifier.padding(start = 12.dp).weight(1f),
                )
            }

            Row(
                Modifier.fillMaxWidth().padding(top = 8.dp),
                horizontalArrangement = Arrangement.End,
            ) {
                TextButton(onClick = onCancel) { Text(stringResource(R.string.cancel)) }
                Button(
                    onClick = {
                        val b = bitmap ?: return@Button
                        val rect = ProfilePhoto.cropRect(
                            imageWidth = b.width,
                            imageHeight = b.height,
                            viewport = viewportPx,
                            zoom = zoom,
                            offsetX = offset.x,
                            offsetY = offset.y,
                        )
                        onConfirm(ProfilePhoto.crop(b, rect))
                    },
                    enabled = bitmap != null && viewportPx > 0,
                    modifier = Modifier.padding(start = 8.dp),
                ) {
                    Text(stringResource(R.string.save_photo))
                }
            }
        }
    }
}
