package dev.convocados.ui.theme

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext

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

    // Material You dynamic color is only available on Android 12 (API 31)+.
    val supportsDynamic = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
    val colorScheme = when {
        dynamicColor && supportsDynamic -> {
            val context = LocalContext.current
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
            LocalConvocadosExpressiveTokens provides ConvocadosExpressiveTokens(
                success = if (darkTheme) Color(0xFF9BD68A) else Color(0xFF2E7D32),
                onSuccess = if (darkTheme) Color(0xFF123016) else Color.White,
                successContainer = if (darkTheme) Color(0xFF214D22) else Color(0xFFD9F2D0),
                onSuccessContainer = if (darkTheme) Color(0xFFC1F2B3) else Color(0xFF102B12),
                warning = if (darkTheme) Color(0xFFFFC94D) else Color(0xFF8A5A00),
                onWarning = if (darkTheme) Color(0xFF382000) else Color.White,
                warningContainer = if (darkTheme) Color(0xFF5A4100) else Color(0xFFFFE0A6),
                onWarningContainer = if (darkTheme) Color(0xFFFFE0A6) else Color(0xFF2A1800),
                live = if (darkTheme) Color(0xFFFFB4AB) else Color(0xFFB3261E),
                onLive = if (darkTheme) Color(0xFF690005) else Color.White,
                offline = if (darkTheme) Color(0xFFBFC5CA) else Color(0xFF5F6368),
                onOffline = if (darkTheme) Color(0xFF293034) else Color.White,
            ),
            content = content,
        )
    }
}
