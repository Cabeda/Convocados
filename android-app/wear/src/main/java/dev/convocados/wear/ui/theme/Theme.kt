package dev.convocados.wear.ui.theme

import androidx.compose.runtime.Composable
import androidx.wear.compose.material3.ColorScheme
import androidx.wear.compose.material3.MaterialTheme

private val WearColorScheme = ColorScheme(
    primary = Primary,
    onPrimary = OnPrimary,
    primaryContainer = PrimaryDark,
    onPrimaryContainer = TextPrimary,
    secondaryContainer = Surface,
    onSecondaryContainer = TextPrimary,
    background = Bg,
    onBackground = TextPrimary,
    surfaceContainer = Surface,
    onSurface = TextPrimary,
    onSurfaceVariant = TextSecondary,
    error = Error,
    onError = OnPrimary,
)

@Composable
fun ConvocadosWearTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = WearColorScheme,
        content = content,
    )
}
