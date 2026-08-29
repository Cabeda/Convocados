package dev.convocados.wear.ui.theme

import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import dev.convocados.designsystem.ExpressiveMotion
import dev.convocados.designsystem.ExpressiveSemanticRole

/** Semantic Wear states shared by glance, score, and offline surfaces. */
@Immutable
data class WearExpressiveTokens(
    val success: Color,
    val warning: Color,
    val live: Color,
    val offline: Color,
    val pending: Color,
    val payment: Color,
    val error: Color,
    val onStatus: Color,
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

    companion object {
        val default: WearExpressiveTokens
            get() = WearExpressiveTokens(
                success = Success,
                warning = Warning,
                live = Tertiary,
                offline = TextMuted,
                pending = Secondary,
                payment = Secondary,
                error = Error,
                onStatus = OnTeam,
            )
    }
}

val LocalWearExpressiveTokens = staticCompositionLocalOf { WearExpressiveTokens.default }
val LocalWearMotion = staticCompositionLocalOf { ExpressiveMotion.Expressive }

@Composable
fun expressiveTokens() = LocalWearExpressiveTokens.current

@Composable
fun expressiveMotion() = LocalWearMotion.current
