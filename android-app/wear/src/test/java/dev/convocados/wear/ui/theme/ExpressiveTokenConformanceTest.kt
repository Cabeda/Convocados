package dev.convocados.wear.ui.theme

import androidx.compose.ui.graphics.Color
import dev.convocados.designsystem.ExpressiveSemanticContract
import dev.convocados.designsystem.ExpressiveSemanticRole
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

class ExpressiveTokenConformanceTest {

    @Test
    fun `wear maps every shared semantic role to a concrete role color`() {
        val tokens = WearExpressiveTokens.default

        ExpressiveSemanticContract.requiredRoles.forEach { role ->
            assertNotEquals(Color.Unspecified, tokens.colorFor(role))
        }
        assertEquals(tokens.success, tokens.colorFor(ExpressiveSemanticRole.Success))
        assertEquals(tokens.warning, tokens.colorFor(ExpressiveSemanticRole.Warning))
        assertEquals(tokens.live, tokens.colorFor(ExpressiveSemanticRole.Live))
        assertEquals(tokens.offline, tokens.colorFor(ExpressiveSemanticRole.Offline))
        assertEquals(tokens.pending, tokens.colorFor(ExpressiveSemanticRole.Pending))
        assertEquals(tokens.payment, tokens.colorFor(ExpressiveSemanticRole.Payment))
        assertEquals(tokens.error, tokens.colorFor(ExpressiveSemanticRole.Error))
    }
}
