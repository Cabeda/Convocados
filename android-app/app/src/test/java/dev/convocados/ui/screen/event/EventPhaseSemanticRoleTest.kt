package dev.convocados.ui.screen.event

import dev.convocados.data.api.BalanceResponse
import dev.convocados.data.api.PlayerBalance
import dev.convocados.designsystem.ExpressiveSemanticRole
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class EventPhaseSemanticRoleTest {

    @Test
    fun `urgent and live phases use shared semantic roles`() {
        assertEquals(ExpressiveSemanticRole.Warning, phaseSemanticRole(EventPhase.SOON))
        assertEquals(ExpressiveSemanticRole.Error, phaseSemanticRole(EventPhase.URGENT))
        assertEquals(ExpressiveSemanticRole.Live, phaseSemanticRole(EventPhase.LIVE))
    }

    @Test
    fun `normal phase keeps primary and past phase uses offline role`() {
        assertEquals(null, phaseSemanticRole(EventPhase.NORMAL))
        assertEquals(ExpressiveSemanticRole.Offline, phaseSemanticRole(EventPhase.PAST))
    }
    @Test
    fun `payment deep links open the prompt when balance is known even at zero`() {
        assertTrue(
            shouldShowAutoPaymentPrompt(
                autoOpenPay = true,
                balance = BalanceResponse(callerBalance = PlayerBalance(amount = 0.0)),
            ),
        )
    }
}
