package dev.convocados.wear.ui.theme

import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

/** Semantic Wear states shared by glance, score, and offline surfaces. */
@Immutable
data class WearExpressiveTokens(
    val success: Color,
    val warning: Color,
    val live: Color,
    val offline: Color,
    val pending: Color,
    val onStatus: Color,
)

val LocalWearExpressiveTokens = staticCompositionLocalOf {
    WearExpressiveTokens(
        success = Success,
        warning = Warning,
        live = Tertiary,
        offline = TextMuted,
        pending = Secondary,
        onStatus = OnTeam,
    )
}


@Composable
fun expressiveTokens() = LocalWearExpressiveTokens.current
