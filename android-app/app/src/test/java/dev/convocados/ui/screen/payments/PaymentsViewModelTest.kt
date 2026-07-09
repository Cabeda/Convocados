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
    fun `toggle updates observable status in place on success`() = runTest {
        // Regression: the user reported the row status not changing after tapping.
        // The API write succeeds (verified on-device, HTTP 200) but the UI must
        // also reflect the new status via the data StateFlow.
        val response = PaymentsResponse(
            payments = listOf(
                Payment("p1", "Alice", 5.0, "pending"),
                Payment("p2", "Bob", 5.0, "pending"),
            ),
            summary = PaymentSummary(paidCount = 0, pendingCount = 2, totalCount = 2, paidAmount = 0.0),
        )
        coEvery { api.fetchPayments("e1") } returns response
        coEvery { api.updatePaymentStatus("e1", "Alice", "paid") } returns OkResponse()

        val vm = PaymentsViewModel(api)
        vm.load("e1")
        advanceUntilIdle()

        vm.toggle("e1", "Alice", "pending")
        advanceUntilIdle()

        val data = vm.data.value!!
        assertEquals("paid", data.payments.first { it.id == "p1" }.status)
        assertEquals("pending", data.payments.first { it.id == "p2" }.status)
        assertEquals(1, data.summary.paidCount)
        assertEquals(1, data.summary.pendingCount)
        assertNull(vm.error.value)
    }

    @Test
    fun `toggle surfaces error and leaves status unchanged on failure`() = runTest {
        // If the write fails (e.g. 403 for a non-owner/admin) the row must stay
        // as-is and an error must be surfaced rather than failing silently.
        val response = PaymentsResponse(
            payments = listOf(Payment("p1", "Alice", 5.0, "pending")),
            summary = PaymentSummary(pendingCount = 1, totalCount = 1),
        )
        coEvery { api.fetchPayments("e1") } returns response
        coEvery { api.updatePaymentStatus("e1", "Alice", "paid") } throws
            ApiException(403, "Only the event owner can do this.")

        val vm = PaymentsViewModel(api)
        vm.load("e1")
        advanceUntilIdle()

        vm.toggle("e1", "Alice", "pending")
        advanceUntilIdle()

        assertEquals("pending", vm.data.value!!.payments.first().status)
        assertNotNull(vm.error.value)
    }

    @Test
    fun `bulkMarkAllPaid reloads to reflect all paid`() = runTest {
        // "Marcar pagamentos" -> bulk button. After success it re-fetches; the
        // second fetch returns everything paid so the UI reflects it.
        val pending = PaymentsResponse(
            payments = listOf(Payment("p1", "Alice", 5.0, "pending"), Payment("p2", "Bob", 5.0, "pending")),
            summary = PaymentSummary(pendingCount = 2, totalCount = 2),
        )
        val allPaid = PaymentsResponse(
            payments = listOf(Payment("p1", "Alice", 5.0, "paid"), Payment("p2", "Bob", 5.0, "paid")),
            summary = PaymentSummary(paidCount = 2, totalCount = 2, paidAmount = 10.0),
        )
        coEvery { api.fetchPayments("e1") } returnsMany listOf(pending, allPaid)
        coEvery { api.bulkMarkAllPaid("e1") } returns OkResponse()

        val vm = PaymentsViewModel(api)
        vm.load("e1")
        advanceUntilIdle()
        assertEquals(2, vm.data.value!!.summary.pendingCount)

        vm.bulkMarkAllPaid("e1")
        advanceUntilIdle()

        assertEquals(2, vm.data.value!!.summary.paidCount)
        assertTrue(vm.data.value!!.payments.all { it.status == "paid" })
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
