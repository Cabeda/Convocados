package dev.convocados.wear.ui.theme

import android.content.Context
import android.database.ContentObserver
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import dev.convocados.designsystem.ExpressiveMotion
import dev.convocados.designsystem.ExpressiveMotionPolicy

internal fun systemMotion(context: Context): ExpressiveMotion = ExpressiveMotionPolicy.fromAnimatorScale(readAnimatorScale(context))

@Composable
internal fun rememberSystemMotion(): ExpressiveMotion {
    val context = LocalContext.current
    var animatorScale by remember(context) { mutableFloatStateOf(readAnimatorScale(context)) }
    DisposableEffect(context) {
        val observer = object : ContentObserver(Handler(Looper.getMainLooper())) {
            override fun onChange(selfChange: Boolean) {
                animatorScale = readAnimatorScale(context)
            }
        }
        val resolver = context.contentResolver
        resolver.registerContentObserver(
            Settings.Global.getUriFor(Settings.Global.ANIMATOR_DURATION_SCALE),
            false,
            observer,
        )
        onDispose { resolver.unregisterContentObserver(observer) }
    }
    return ExpressiveMotionPolicy.fromAnimatorScale(animatorScale)
}

private fun readAnimatorScale(context: Context): Float = runCatching {
    Settings.Global.getFloat(
        context.contentResolver,
        Settings.Global.ANIMATOR_DURATION_SCALE,
        1f,
    )
}.getOrDefault(1f)
