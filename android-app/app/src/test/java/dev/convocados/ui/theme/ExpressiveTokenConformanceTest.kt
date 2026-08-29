package dev.convocados.ui.theme

import androidx.compose.ui.graphics.Color
import dev.convocados.designsystem.ExpressiveSemanticContract
import org.junit.Assert.assertTrue
import org.junit.Test

class ExpressiveTokenConformanceTest {

    @Test
    fun `phone maps every shared semantic role`() {
        ExpressiveSemanticContract.requiredRoles.forEach { role ->
            assertTrue(LightConvocadosExpressiveTokens.colorFor(role) != Color.Unspecified)
            assertTrue(DarkConvocadosExpressiveTokens.colorFor(role) != Color.Unspecified)
        }
    }

    @Test
    fun `phone semantic roles meet readable contrast in light and dark themes`() {
        ExpressiveSemanticContract.requiredRoles.forEach { role ->
            assertTrue(
                "Light $role contrast is too low",
                contrastRatio(
                    LightConvocadosExpressiveTokens.colorFor(role),
                    LightConvocadosExpressiveTokens.onColorFor(role),
                ) >= 4.5,
            )
            assertTrue(
                "Dark $role contrast is too low",
                contrastRatio(
                    DarkConvocadosExpressiveTokens.colorFor(role),
                    DarkConvocadosExpressiveTokens.onColorFor(role),
                ) >= 4.5,
            )
        }
    }

    private fun contrastRatio(first: Color, second: Color): Double {
        fun channel(value: Float): Double {
            val sRgb = value.toDouble()
            return if (sRgb <= 0.03928) sRgb / 12.92 else Math.pow((sRgb + 0.055) / 1.055, 2.4)
        }

        fun luminance(color: Color): Double =
            0.2126 * channel(color.red) + 0.7152 * channel(color.green) + 0.0722 * channel(color.blue)

        val firstLuminance = luminance(first)
        val secondLuminance = luminance(second)
        val lighter = maxOf(firstLuminance, secondLuminance)
        val darker = minOf(firstLuminance, secondLuminance)
        return (lighter + 0.05) / (darker + 0.05)
    }
}
