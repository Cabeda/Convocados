package dev.convocados.designsystem

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ExpressiveSemanticContractTest {

    @Test
    fun `contract exposes every cross-device semantic role`() {
        assertEquals(
            setOf(
                ExpressiveSemanticRole.Success,
                ExpressiveSemanticRole.Warning,
                ExpressiveSemanticRole.Live,
                ExpressiveSemanticRole.Offline,
                ExpressiveSemanticRole.Pending,
                ExpressiveSemanticRole.Payment,
                ExpressiveSemanticRole.Error,
            ),
            ExpressiveSemanticContract.requiredRoles,
        )
    }

    @Test
    fun `brand and product state roles are explicit`() {
        assertEquals(
            ExpressiveSemanticContract.requiredRoles,
            ExpressiveSemanticContract.brandPreservedRoles,
        )
    }

    @Test
    fun `zero animator scale selects reduced motion`() {
        assertEquals(
            ExpressiveMotion.Reduced,
            ExpressiveMotionPolicy.fromAnimatorScale(0f),
        )
        assertEquals(
            ExpressiveMotion.Expressive,
            ExpressiveMotionPolicy.fromAnimatorScale(1f),
        )
    }

    @Test
    fun `negative animator scale is treated as reduced motion`() {
        assertTrue(ExpressiveMotionPolicy.fromAnimatorScale(-1f) == ExpressiveMotion.Reduced)
    }
}
