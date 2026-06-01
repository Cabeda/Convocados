package dev.convocados.ui.theme

import org.junit.Assert.*
import org.junit.Test

class ThemeModeTest {

    @Test
    fun `ThemeMode has System Light and Dark values`() {
        val modes = ThemeMode.entries
        assertEquals(3, modes.size)
        assertEquals(ThemeMode.System, modes[0])
        assertEquals(ThemeMode.Light, modes[1])
        assertEquals(ThemeMode.Dark, modes[2])
    }

    @Test
    fun `LightColors and DarkColors are distinct schemes`() {
        assertNotEquals(LightColors.primary, DarkColors.primary)
        assertNotEquals(LightColors.background, DarkColors.background)
        assertNotEquals(LightColors.surface, DarkColors.surface)
        assertNotEquals(LightColors.onSurface, DarkColors.onSurface)
    }

    @Test
    fun `DarkColors has proper contrast between foreground and background roles`() {
        assertNotEquals(DarkColors.primary, DarkColors.onPrimary)
        assertNotEquals(DarkColors.surface, DarkColors.onSurface)
        assertNotEquals(DarkColors.background, DarkColors.onBackground)
        assertNotEquals(DarkColors.secondary, DarkColors.onSecondary)
        assertNotEquals(DarkColors.tertiary, DarkColors.onTertiary)
        assertNotEquals(DarkColors.error, DarkColors.onError)
    }

    @Test
    fun `LightColors has proper contrast between foreground and background roles`() {
        assertNotEquals(LightColors.primary, LightColors.onPrimary)
        assertNotEquals(LightColors.surface, LightColors.onSurface)
        assertNotEquals(LightColors.background, LightColors.onBackground)
        assertNotEquals(LightColors.secondary, LightColors.onSecondary)
        assertNotEquals(LightColors.tertiary, LightColors.onTertiary)
        assertNotEquals(LightColors.error, LightColors.onError)
    }
}
