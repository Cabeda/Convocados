package dev.convocados.wear.ui.theme

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.wear.compose.material3.ColorScheme
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.MotionScheme

// Material 3 Expressive lexical palette, mapped 1:1 to the M3 ColorScheme roles
// (ADR 0019/ADR 0027 design language, "Tactile Minimalism, Nordic"). Keeping the
// brand intent: OLED black, muted warm tones, bone text, sage/clay team tiles.
private val WearColorScheme: ColorScheme = ColorScheme(
    primary = Primary,
    primaryDim = PrimaryDim,
    onPrimary = OnPrimary,
    primaryContainer = TeamOne,
    onPrimaryContainer = OnTeam,

    secondary = Secondary,
    secondaryDim = SecondaryDim,
    onSecondary = OnSecondary,
    secondaryContainer = Surface,
    onSecondaryContainer = TextPrimary,

    tertiary = Tertiary,
    tertiaryDim = TertiaryDim,
    onTertiary = OnTertiary,
    tertiaryContainer = TeamTwo,
    onTertiaryContainer = OnTeam,

    background = Bg,
    onBackground = TextPrimary,

    surfaceContainerLow = Surface,
    surfaceContainer = SurfaceHover,
    surfaceContainerHigh = SurfaceHigh,
    onSurface = TextPrimary,
    onSurfaceVariant = TextMuted,

    outline = Border,
    outlineVariant = OutlineVariant,

    error = Error,
    errorDim = ErrorDim,
    errorContainer = ErrorContainer,
    onError = OnPrimary,
    onErrorContainer = OnErrorContainer,
)

@Composable
fun ConvocadosWearTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = WearColorScheme,
        // Expressive motion: dynamic component animations (pulse, press, entrance)
        // so the score/editing surfaces feel alive rather than static.
        motionScheme = MotionScheme.expressive(),
    ) {
        CompositionLocalProvider(
            LocalWearExpressiveTokens provides WearExpressiveTokens(
                success = Success,
                warning = Warning,
                live = Tertiary,
                offline = TextMuted,
                pending = Secondary,
                onStatus = OnTeam,
            ),
            content = content,
        )
    }
}

// M3 default Wear shapes + typography are left at their defaults — they are
// optimized for round devices and flex fonts; overriding them would fight the
// Expressive system rather than extend it.
