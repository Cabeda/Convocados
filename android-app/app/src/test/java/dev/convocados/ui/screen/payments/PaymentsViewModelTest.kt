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
    fun `load fetches settlement summary`() = runTest {
        val response = SettlementSummary(
            games = listOf(SettlementGame("g1", dateTime = "2026-08-20T19:00:00Z", payerName = "Alice", total = 10.0, rows = listOf(SettlementRow("ep1", "Bob", 5.0, "pending")))),
            people = listOf(SettlementPerson("Alice", isPlayer = true, isPayer = true, owedToAmount = 10.0)),
            viewerRole = "owner",
        )
        coEvery { api.fetchSettlement("e1") } returns response

        val vm = PaymentsViewModel(api)
        vm.load("e1")
        advanceUntilIdle()

        assertEquals(response, vm.data.value)
        assertEquals(false, vm.loading.value)
        assertNull(vm.error.value)
    }

    @Test
    fun `settle calls api and reloads`() = runTest {
        val response = SettlementSummary(viewerRole = "owner")
        coEvery { api.fetchSettlement("e1") } returnsMany listOf(response.copy(games = listOf(SettlementGame("g1"))), response)
        coEvery { api.settleShare("e1", "g1", "ep1") } returns OkResponse()

        val vm = PaymentsViewModel(api)
        vm.load("e1")
        advanceUntilIdle()

        vm.settle("e1", "g1", "ep1")
        advanceUntilIdle()

        coVerify { api.settleShare("e1", "g1", "ep1") }
        coVerify(atLeast = 2) { api.fetchSettlement("e1") }
    }

    @Test
    fun `settleAll calls api and reloads`() = runTest {
        val response = SettlementSummary(viewerRole = "owner")
        coEvery { api.fetchSettlement("e1") } returnsMany listOf(response, response)
        coEvery { api.settleAll("e1", "g1") } returns OkResponse()

        val vm = PaymentsViewModel(api)
        vm.load("e1")
        advanceUntilIdle()

        vm.settleAll("e1", "g1")
        advanceUntilIdle()

        coVerify { api.settleAll("e1", "g1") }
    }

    @Test
    fun `reportSent calls api and reloads`() = runTest {
        val response = SettlementSummary(viewerRole = "player", viewerEventPlayerId = "ep1")
        coEvery { api.fetchSettlement("e1") } returnsMany listOf(response, response)
        coEvery { api.selfReportSent("e1", "g1", "ep1") } returns OkResponse()

        val vm = PaymentsViewModel(api)
        vm.load("e1")
        advanceUntilIdle()

        vm.reportSent("e1", "g1", "ep1")
        advanceUntilIdle()

        coVerify { api.selfReportSent("e1", "g1", "ep1") }
    }

    @Test
    fun `mutation surfaces error on failure`() = runTest {
        val response = SettlementSummary(viewerRole = "owner")
        coEvery { api.fetchSettlement("e1") } returns response
        coEvery { api.settleAll("e1", "g1") } throws ApiException(403, "Only the event owner can do this.")

        val vm = PaymentsViewModel(api)
        vm.load("e1")
        advanceUntilIdle()

        vm.settleAll("e1", "g1")
        advanceUntilIdle()

        assertNotNull(vm.error.value)
    }
}
