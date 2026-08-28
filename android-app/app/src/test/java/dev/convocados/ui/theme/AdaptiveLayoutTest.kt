package dev.convocados.ui.theme

import org.junit.Assert.assertEquals
import org.junit.Test

class AdaptiveLayoutTest {

    @Test
    fun `width buckets match compact medium and expanded form factors`() {
        assertEquals(ConvocadosLayout.Compact, layoutForWidthDp(599))
        assertEquals(ConvocadosLayout.Medium, layoutForWidthDp(600))
        assertEquals(ConvocadosLayout.Expanded, layoutForWidthDp(840))
    }

    @Test
    fun `content widths preserve readable bounds`() {
        assertEquals(600, contentMaxWidthDp(ConvocadosLayout.Compact))
        assertEquals(840, contentMaxWidthDp(ConvocadosLayout.Medium))
        assertEquals(1200, contentMaxWidthDp(ConvocadosLayout.Expanded))
    }
}
