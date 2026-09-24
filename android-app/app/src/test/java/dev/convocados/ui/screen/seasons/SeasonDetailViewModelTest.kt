package dev.convocados.ui.screen.seasons

import dev.convocados.data.api.ConvocadosApi
import dev.convocados.data.api.CrewProposal
import dev.convocados.data.api.CrewProposalCandidate
import dev.convocados.data.api.CrewProposalResponse
import dev.convocados.data.api.CrewProposalsResponse
import dev.convocados.data.api.EventDetail
import dev.convocados.data.api.SeasonDetailResponse
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
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class SeasonDetailViewModelTest {
    private val api = mockk<ConvocadosApi>(relaxed = true)
    private val testDispatcher = StandardTestDispatcher()

    @Before
    fun setup() { Dispatchers.setMain(testDispatcher) }

    @After
    fun tearDown() { Dispatchers.resetMain() }

    private fun stubLoad(proposals: CrewProposalsResponse = CrewProposalsResponse()) {
        coEvery { api.fetchEvent(any()) } returns EventDetail(id = "e1", title = "Event", dateTime = "2026-01-01T10:00:00Z", maxPlayers = 10)
        coEvery { api.fetchSeasonDetail(any(), any()) } returns SeasonDetailResponse()
        coEvery { api.fetchCrewProposals(any(), any()) } returns proposals
    }

    @Test
    fun `load surfaces proposals and the propose and review flags`() = runTest {
        stubLoad(
            CrewProposalsResponse(
                proposals = listOf(
                    CrewProposal(
                        id = "p1",
                        name = "Rockets",
                        status = "pending",
                        proposerName = "Alice",
                        memberNames = listOf("Alice", "Bob", "Carol"),
                    ),
                ),
                candidates = listOf(
                    CrewProposalCandidate(membershipId = "m1", name = "Alice"),
                    CrewProposalCandidate(membershipId = "m2", name = "Bob"),
                ),
                proposerMembershipId = "m1",
                canPropose = true,
                canReview = false,
            ),
        )

        val vm = SeasonDetailViewModel(api)
        vm.load("e1", "s1")
        advanceUntilIdle()

        assertEquals(1, vm.proposals.value.size)
        assertEquals("Rockets", vm.proposals.value[0].name)
        assertEquals(2, vm.proposalCandidates.value.size)
        assertTrue(vm.canPropose.value)
        assertFalse(vm.canReview.value)
        assertEquals("m1", vm.proposerMembershipId.value)
    }

    @Test
    fun `submitProposal posts the members and reloads proposals`() = runTest {
        stubLoad()
        coEvery { api.submitCrewProposal(any(), any(), any(), any()) } returns CrewProposalResponse(CrewProposal(id = "p1", name = "Rockets"))

        val vm = SeasonDetailViewModel(api)
        vm.load("e1", "s1")
        advanceUntilIdle()

        vm.submitProposal("e1", "s1", "Rockets", listOf("m1", "m2", "m3"))
        advanceUntilIdle()

        coVerify { api.submitCrewProposal("e1", "s1", "Rockets", listOf("m1", "m2", "m3")) }
        coVerify(atLeast = 1) { api.fetchCrewProposals("e1", "s1") }
    }

    @Test
    fun `decideProposal approves through the API and reloads the season`() = runTest {
        stubLoad()
        coEvery { api.decideCrewProposal(any(), any(), any(), any(), any()) } returns CrewProposalResponse(CrewProposal(id = "p1", status = "approved"))

        val vm = SeasonDetailViewModel(api)
        vm.load("e1", "s1")
        advanceUntilIdle()

        vm.decideProposal("e1", "s1", "p1", "approve")
        advanceUntilIdle()

        coVerify { api.decideCrewProposal("e1", "s1", "p1", "approve", null) }
        coVerify(atLeast = 2) { api.fetchSeasonDetail("e1", "s1") }
    }

    @Test
    fun `decideProposal forwards a rejection reason`() = runTest {
        stubLoad()
        coEvery { api.decideCrewProposal(any(), any(), any(), any(), any()) } returns CrewProposalResponse(CrewProposal(id = "p1", status = "rejected"))

        val vm = SeasonDetailViewModel(api)
        vm.load("e1", "s1")
        advanceUntilIdle()

        vm.decideProposal("e1", "s1", "p1", "reject", "Too strong")
        advanceUntilIdle()

        coVerify { api.decideCrewProposal("e1", "s1", "p1", "reject", "Too strong") }
    }
}
