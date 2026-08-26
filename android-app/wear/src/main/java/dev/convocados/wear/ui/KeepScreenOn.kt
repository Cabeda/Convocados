package dev.convocados.wear.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.platform.LocalView

/**
 * Holds the screen awake while [enabled] (mirrors the per-event "Keep screen on"
 * setting). Works on any screen — the teams/roster editor, the scoring screen
 * pre-start and live, so a solo organizer is never interrupted by the watch
 * sleeping mid-setup.
 */
@Composable
fun RememberKeepScreenOn(enabled: Boolean) {
    val view = LocalView.current
    DisposableEffect(view, enabled) {
        val previous = view.keepScreenOn
        view.keepScreenOn = enabled
        onDispose {
            view.keepScreenOn = previous
        }
    }
}
