package dev.convocados.ui.screen.payments

import dev.convocados.data.api.*
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.*
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class PaymentsViewModelTest {
    private val api = mockk<ConvocadosApi>()
    private val testDispatcher = StandardTestDispatcher()

    @Before
    fun setup() { Dispatchers.setMain(testDispatcher) }

    @After
    fun tearDown() { Dispatchers.resetMain() }

    @Test
    fun `load fetches payments`() = runTest {
        val response = PaymentsResponse(
            payments = listOf(Payment("p1", "Alice", 5.0, "paid")),
            summary = PaymentSummary(1, 0, 1, 5.0),
            totalAmount = 10.0,
        )
        coEvery { api.fetchPayments("e1") } returns response

        val vm = PaymentsViewModel(api)
        vm.load("e1")
        advanceUntilIdle()

        assertEquals(response, vm.data.value)
        assertEquals(false, vm.loading.value)
    }

    @Test
    fun `toggle changes payment status and reloads`() = runTest {
        val response = PaymentsResponse(payments = listOf(Payment("p1", "Alice", 5.0, "paid")))
        coEvery { api.fetchPayments("e1") } returns response
        coEvery { api.updatePaymentStatus("e1", "Alice", "pending") } returns OkResponse()

        val vm = PaymentsViewModel(api)
        vm.load("e1")
        advanceUntilIdle()

        vm.toggle("e1", "Alice", "paid")
        advanceUntilIdle()

        coVerify { api.updatePaymentStatus("e1", "Alice", "pending") }
    }

    @Test
    fun `setCostOverride calls api and reloads`() = runTest {
        val response = PaymentsResponse(payments = listOf(Payment("p1", "Bob", 5.0, "pending")))
        coEvery { api.fetchPayments("e1") } returns response
        coEvery { api.setCostOverride("e1", "Bob", 7.5) } returns OkResponse()

        val vm = PaymentsViewModel(api)
        vm.load("e1")
        advanceUntilIdle()

        vm.setCostOverride("e1", "Bob", 7.5)
        advanceUntilIdle()

        coVerify { api.setCostOverride("e1", "Bob", 7.5) }
        coVerify(atLeast = 2) { api.fetchPayments("e1") }
    }
}
