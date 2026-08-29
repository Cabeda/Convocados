package dev.convocados.ui.theme

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalContext
import dev.convocados.designsystem.ExpressiveMotion

enum class ThemeMode { System, Light, Dark }

@Composable
fun ConvocadosTheme(
    themeMode: ThemeMode = ThemeMode.System,
    dynamicColor: Boolean = false,
    content: @Composable () -> Unit,
) {
    val darkTheme = when (themeMode) {
        ThemeMode.System -> isSystemInDarkTheme()
        ThemeMode.Light -> false
        ThemeMode.Dark -> true
    }

    val context = LocalContext.current
    val motion = rememberSystemMotion()

    // Material You dynamic color is only available on Android 12 (API 31)+.
    val supportsDynamic = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
    val colorScheme = when {
        dynamicColor && supportsDynamic -> {
            if (darkTheme) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        }
        darkTheme -> DarkColors
        else -> LightColors
    }

    MaterialTheme(
        colorScheme = colorScheme,
        typography = AppTypography,
        shapes = AppShapes,
    ) {
        CompositionLocalProvider(
            LocalConvocadosExpressiveTokens provides if (darkTheme) {
                DarkConvocadosExpressiveTokens
            } else {
                LightConvocadosExpressiveTokens
            },
            LocalConvocadosMotion provides motion,
            content = content,
        )
    }
}
