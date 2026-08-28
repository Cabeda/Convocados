package dev.convocados.wear.ui.screen.mvp

import dev.convocados.wear.data.api.ApiException
import dev.convocados.wear.data.api.MvpParticipant
import dev.convocados.wear.data.api.MvpResponse
import dev.convocados.wear.data.api.MvpVoteResponse
import dev.convocados.wear.data.api.MvpVoteResult
import dev.convocados.wear.data.api.WearApiClient
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
import kotlinx.serialization.json.Json
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class MvpVotingViewModelTest {

    private val client = mockk<WearApiClient>()
    private val testDispatcher = StandardTestDispatcher()

    @Before
    fun setup() {
        Dispatchers.setMain(testDispatcher)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun `load exposes historical participants and current vote`() = runTest {
        coEvery { client.getMvp("event-1", "history-1") } returns openResponse(
            hasVoted = true,
            participants = listOf(
                MvpParticipant("player-1", "Alice", 2),
                MvpParticipant("name:Guest", "Guest", 0),
            ),
        )

        val viewModel = MvpVotingViewModel(client)
        viewModel.load("event-1", "history-1")
        advanceUntilIdle()

        val state = viewModel.uiState.value
        assertFalse(state.isLoading)
        assertEquals(listOf("player-1", "name:Guest"), state.response?.participants?.map { it.playerId })
        assertTrue(state.response?.hasVoted == true)
        assertNull(state.error)
    }

    @Test
    fun `mvp response decodes server participant field names`() {
        val response = Json.decodeFromString<MvpResponse>(
            """
            {
              "mvp": null,
              "isVotingOpen": true,
              "hasVoted": false,
              "totalVotes": 1,
              "eligibleVoters": 2,
              "participants": [
                {"id": "name:Guest", "name": "Guest", "voteCount": 1}
              ]
            }
            """.trimIndent(),
        )

        assertEquals("name:Guest", response.participants.single().playerId)
        assertEquals("Guest", response.participants.single().playerName)
        assertEquals(1, response.participants.single().voteCount)
    }

    @Test
    fun `non-participant cannot submit a vote`() = runTest {
        coEvery { client.getMvp("event-1", "history-1") } returns openResponse(hasVoted = null)

        val viewModel = MvpVotingViewModel(client)
        viewModel.load("event-1", "history-1")
        advanceUntilIdle()
        viewModel.vote("player-1")
        advanceUntilIdle()

        coVerify(exactly = 0) {
            client.castMvpVote("event-1", "history-1", "player-1")
        }
        assertFalse(viewModel.uiState.value.isSubmitting)
    }

    @Test
    fun `vote posts selected historical participant then refreshes results`() = runTest {
        val initial = openResponse(hasVoted = false)
        val refreshed = initial.copy(
            hasVoted = true,
            totalVotes = 1,
            participants = listOf(MvpParticipant("player-1", "Alice", 1)),
        )
        coEvery { client.getMvp("event-1", "history-1") } returnsMany listOf(initial, refreshed)
        coEvery {
            client.castMvpVote("event-1", "history-1", "player-1")
        } returns MvpVoteResponse(
            ok = true,
            vote = MvpVoteResult(id = "vote-1", votedForName = "Alice"),
        )

        val viewModel = MvpVotingViewModel(client)
        viewModel.load("event-1", "history-1")
        advanceUntilIdle()
        viewModel.vote("player-1")
        advanceUntilIdle()

        coVerify(exactly = 1) {
            client.castMvpVote("event-1", "history-1", "player-1")
        }
        coVerify(exactly = 2) { client.getMvp("event-1", "history-1") }
        assertFalse(viewModel.uiState.value.isSubmitting)
        assertEquals(1, viewModel.uiState.value.response?.totalVotes)
        assertNull(viewModel.uiState.value.error)
    }

    @Test
    fun `self vote failure becomes concise retryable error`() = runTest {
        coEvery { client.getMvp("event-1", "history-1") } returns openResponse(hasVoted = false)
        coEvery {
            client.castMvpVote("event-1", "history-1", "player-1")
        } throws ApiException(400, "You cannot vote for yourself")

        val viewModel = MvpVotingViewModel(client)
        viewModel.load("event-1", "history-1")
        advanceUntilIdle()
        viewModel.vote("player-1")
        advanceUntilIdle()

        assertFalse(viewModel.uiState.value.isSubmitting)
        assertEquals("You cannot vote for yourself.", viewModel.uiState.value.error)
    }

    private fun openResponse(
        hasVoted: Boolean?,
        participants: List<MvpParticipant> = listOf(
            MvpParticipant("player-1", "Alice", 0),
            MvpParticipant("player-2", "Bob", 0),
        ),
    ) = MvpResponse(
        mvp = emptyList(),
        isVotingOpen = true,
        hasVoted = hasVoted,
        totalVotes = 0,
        eligibleVoters = 2,
        participants = participants,
    )
}
