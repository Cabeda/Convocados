package dev.convocados.ui.screen.payments

import dev.convocados.data.api.ApiException
import dev.convocados.data.api.ConvocadosApi
import dev.convocados.data.api.OkResponse
import dev.convocados.data.api.PayerState
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class PayerCardViewModelTest {
    private val api = mockk<ConvocadosApi>()
    private val testDispatcher = StandardTestDispatcher()

    @Before
    fun setup() { Dispatchers.setMain(testDispatcher) }

    @After
    fun tearDown() { Dispatchers.resetMain() }

    private fun state(
        payerName: String? = null,
        isPayer: Boolean = false,
        vacant: Boolean = false,
    ) = PayerState(
        gameId = "g1",
        mode = "tracked",
        hasCost = true,
        payerName = payerName,
        isPayer = isPayer,
        isRosterPlayer = true,
        canClaim = true,
        vacant = vacant,
    )

    @Test
    fun `unclaimed payer transitions to claimed`() = runTest {
        coEvery { api.fetchPayer("e1") } returnsMany listOf(
            state(),
            state(payerName = "Ana", isPayer = true),
        )
        coEvery { api.claimPayer("e1") } returns OkResponse()

        val vm = PayerCardViewModel(api)
        vm.load("e1")
        advanceUntilIdle()
        assertNull(vm.state.value?.payerName)

        vm.claim("e1")
        advanceUntilIdle()

        assertEquals("Ana", vm.state.value?.payerName)
        assertTrue(vm.state.value!!.isPayer)
        assertFalse(vm.state.value!!.vacant)
        coVerify { api.claimPayer("e1") }
    }

    @Test
    fun `claimed payer transitions to stood down`() = runTest {
        coEvery { api.fetchPayer("e1") } returnsMany listOf(
            state(payerName = "Ana", isPayer = true),
            state(vacant = true),
        )
        coEvery { api.standDownPayer("e1") } returns OkResponse()

        val vm = PayerCardViewModel(api)
        vm.load("e1")
        advanceUntilIdle()
        assertTrue(vm.state.value!!.isPayer)

        vm.standDown("e1")
        advanceUntilIdle()

        assertNull(vm.state.value?.payerName)
        assertTrue(vm.state.value!!.vacant)
        assertFalse(vm.state.value!!.isPayer)
        coVerify { api.standDownPayer("e1") }
    }

    @Test
    fun `vacant payer transitions to claimed`() = runTest {
        coEvery { api.fetchPayer("e1") } returnsMany listOf(
            state(vacant = true),
            state(payerName = "Ana", isPayer = true),
        )
        coEvery { api.claimPayer("e1") } returns OkResponse()

        val vm = PayerCardViewModel(api)
        vm.load("e1")
        advanceUntilIdle()
        assertTrue(vm.state.value!!.vacant)

        vm.claim("e1")
        advanceUntilIdle()

        assertEquals("Ana", vm.state.value?.payerName)
        assertFalse(vm.state.value!!.vacant)
        coVerify { api.claimPayer("e1") }
    }

    @Test
    fun `a 403 surfaces the server message instead of failing silently`() = runTest {
        coEvery { api.fetchPayer("e1") } returns state()
        coEvery { api.claimPayer("e1") } throws ApiException(
            403,
            "Only an active roster player can claim the payer role.",
        )

        val vm = PayerCardViewModel(api)
        vm.load("e1")
        advanceUntilIdle()

        vm.claim("e1")
        advanceUntilIdle()

        assertEquals(
            "Only an active roster player can claim the payer role.",
            vm.error.value,
        )
    }
}
