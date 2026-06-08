package dev.convocados.ui.theme

import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.ui.graphics.Color

/**
 * Color palette matching the web app (src/components/ThemeModeProvider.tsx).
 * M3 tonal palette derived from seed #1b6b4a (green).
 */

val LightColors = lightColorScheme(
    primary = Color(0xFF1B6B4A),
    onPrimary = Color(0xFFFFFFFF),
    primaryContainer = Color(0xFF8CF8C2),
    onPrimaryContainer = Color(0xFF002112),
    secondary = Color(0xFF4A6358),
    onSecondary = Color(0xFFFFFFFF),
    secondaryContainer = Color(0xFFCEE8DA),
    onSecondaryContainer = Color(0xFF0A1F15),
    tertiary = Color(0xFF3D6472),
    onTertiary = Color(0xFFFFFFFF),
    tertiaryContainer = Color(0xFFC0E9FA),
    onTertiaryContainer = Color(0xFF001F28),
    error = Color(0xFFBA1A1A),
    onError = Color(0xFFFFFFFF),
    errorContainer = Color(0xFFFFDAD6),
    onErrorContainer = Color(0xFF410002),
    background = Color(0xFFF8FAF6),
    onBackground = Color(0xFF191C1A),
    surface = Color(0xFFFFFFFF),
    onSurface = Color(0xFF191C1A),
    surfaceVariant = Color(0xFFDCE5DC),
    onSurfaceVariant = Color(0xFF404942),
    outline = Color(0xFF707972),
    outlineVariant = Color(0xFFC2C9C1),
    inverseSurface = Color(0xFF2E312E),
    inverseOnSurface = Color(0xFFF0F1ED),
)

val DarkColors = darkColorScheme(
    primary = Color(0xFF7EDCAB),
    onPrimary = Color(0xFF003822),
    primaryContainer = Color(0xFF005233),
    onPrimaryContainer = Color(0xFF8CF8C2),
    secondary = Color(0xFFB2CCBF),
    onSecondary = Color(0xFF1D3A2E),
    secondaryContainer = Color(0xFF364B3F),
    onSecondaryContainer = Color(0xFFCEE8DA),
    tertiary = Color(0xFFA5CDDD),
    onTertiary = Color(0xFF073542),
    tertiaryContainer = Color(0xFF244C59),
    onTertiaryContainer = Color(0xFFC0E9FA),
    error = Color(0xFFFFB4AB),
    onError = Color(0xFF690005),
    errorContainer = Color(0xFF93000A),
    onErrorContainer = Color(0xFFFFDAD6),
    background = Color(0xFF111412),
    onBackground = Color(0xFFE1E3DE),
    surface = Color(0xFF1A1D1B),
    onSurface = Color(0xFFE1E3DE),
    surfaceVariant = Color(0xFF404942),
    onSurfaceVariant = Color(0xFFC0C9C1),
    outline = Color(0xFF8A938C),
    outlineVariant = Color(0xFF3A3F3B),
    inverseSurface = Color(0xFFE1E3DE),
    inverseOnSurface = Color(0xFF2E312E),
)
