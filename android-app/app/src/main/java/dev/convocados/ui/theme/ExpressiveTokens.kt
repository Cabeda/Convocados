package dev.convocados.ui.theme

import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

/**
 * Semantic roles that sit alongside Material 3's ColorScheme. They describe
 * product states which must remain understandable without relying on color alone.
 */
@Immutable
data class ConvocadosExpressiveTokens(
    val success: Color,
    val onSuccess: Color,
    val successContainer: Color,
    val onSuccessContainer: Color,
    val warning: Color,
    val onWarning: Color,
    val warningContainer: Color,
    val onWarningContainer: Color,
    val live: Color,
    val onLive: Color,
    val offline: Color,
    val onOffline: Color,
)

val LocalConvocadosExpressiveTokens = staticCompositionLocalOf {
    ConvocadosExpressiveTokens(
        success = Color(0xFF2E7D32),
        onSuccess = Color.White,
        successContainer = Color(0xFFD9F2D0),
        onSuccessContainer = Color(0xFF102B12),
        warning = Color(0xFF8A5A00),
        onWarning = Color.White,
        warningContainer = Color(0xFFFFE0A6),
        onWarningContainer = Color(0xFF2A1800),
        live = Color(0xFFB3261E),
        onLive = Color.White,
        offline = Color(0xFF5F6368),
        onOffline = Color.White,
    )
}

@Composable
fun expressiveTokens() = LocalConvocadosExpressiveTokens.current
