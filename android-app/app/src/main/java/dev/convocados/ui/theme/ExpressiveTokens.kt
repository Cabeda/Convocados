package dev.convocados.ui.theme

import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import dev.convocados.designsystem.ExpressiveMotion
import dev.convocados.designsystem.ExpressiveSemanticRole

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
    val pending: Color,
    val onPending: Color,
    val payment: Color,
    val onPayment: Color,
    val error: Color,
    val onError: Color,
) {
    fun colorFor(role: ExpressiveSemanticRole): Color = when (role) {
        ExpressiveSemanticRole.Success -> success
        ExpressiveSemanticRole.Warning -> warning
        ExpressiveSemanticRole.Live -> live
        ExpressiveSemanticRole.Offline -> offline
        ExpressiveSemanticRole.Pending -> pending
        ExpressiveSemanticRole.Payment -> payment
        ExpressiveSemanticRole.Error -> error
    }

    fun onColorFor(role: ExpressiveSemanticRole): Color = when (role) {
        ExpressiveSemanticRole.Success -> onSuccess
        ExpressiveSemanticRole.Warning -> onWarning
        ExpressiveSemanticRole.Live -> onLive
        ExpressiveSemanticRole.Offline -> onOffline
        ExpressiveSemanticRole.Pending -> onPending
        ExpressiveSemanticRole.Payment -> onPayment
        ExpressiveSemanticRole.Error -> onError
    }
}

val LightConvocadosExpressiveTokens = ConvocadosExpressiveTokens(
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
    pending = Color(0xFF6A4F00),
    onPending = Color.White,
    payment = Color(0xFF006874),
    onPayment = Color.White,
    error = Color(0xFFBA1A1A),
    onError = Color.White,
)

val DarkConvocadosExpressiveTokens = ConvocadosExpressiveTokens(
    success = Color(0xFF9BD68A),
    onSuccess = Color(0xFF123016),
    successContainer = Color(0xFF214D22),
    onSuccessContainer = Color(0xFFC1F2B3),
    warning = Color(0xFFFFC94D),
    onWarning = Color(0xFF382000),
    warningContainer = Color(0xFF5A4100),
    onWarningContainer = Color(0xFFFFE0A6),
    live = Color(0xFFFFB4AB),
    onLive = Color(0xFF690005),
    offline = Color(0xFFBFC5CA),
    onOffline = Color(0xFF293034),
    pending = Color(0xFFE7C45E),
    onPending = Color(0xFF2E2100),
    payment = Color(0xFF83F0FF),
    onPayment = Color(0xFF00363D),
    error = Color(0xFFFFB4AB),
    onError = Color(0xFF690005),
)

val LocalConvocadosExpressiveTokens = staticCompositionLocalOf { LightConvocadosExpressiveTokens }
val LocalConvocadosMotion = staticCompositionLocalOf { ExpressiveMotion.Expressive }

@Composable
fun expressiveTokens() = LocalConvocadosExpressiveTokens.current

@Composable
fun expressiveMotion() = LocalConvocadosMotion.current
