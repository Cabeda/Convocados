package dev.convocados.ui.screen.games

import dev.convocados.data.api.ApiException
import dev.convocados.data.api.ConvocadosApi
import dev.convocados.data.api.HomeInvitation
import dev.convocados.data.api.HomeResponse
import dev.convocados.data.api.HomeRosterAdd
import dev.convocados.data.api.InviteActionResponse
import dev.convocados.data.api.UserProfile
import dev.convocados.data.api.UserProfileResponse
import dev.convocados.data.api.UserPublicProfile
import dev.convocados.data.auth.TokenStore
import dev.convocados.data.datastore.SettingsStore
import dev.convocados.data.repository.EventRepository
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import kotlinx.coroutines.launch
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class GamesViewModelInvitationsTest {
    private val repository = mockk<EventRepository>(relaxUnitFun = true)
    private val api = mockk<ConvocadosApi>(relaxed = true)
    private val tokenStore = mockk<TokenStore>(relaxed = true)
    private val settingsStore = mockk<SettingsStore>(relaxed = true)
    private val testDispatcher = StandardTestDispatcher()

    private val invitation = HomeInvitation(
        id = "inv1",
        token = "tok1",
        eventId = "e1",
        eventTitle = "Tuesday Football",
        location = "Areosa",
        dateTime = "2026-10-01T18:00:00Z",
        sport = "football-5v5",
        invitedByName = "Rui",
    )

    private val rosterAdd = HomeRosterAdd(
        id = "ra1",
        eventId = "e2",
        eventTitle = "Sunday Padel",
        location = "Padel Club",
        dateTime = "2026-10-02T10:00:00Z",
        sport = "padel",
    )

    @Before
    fun setup() {
        Dispatchers.setMain(testDispatcher)
        every { settingsStore.rosterAddsAcked } returns flowOf(emptySet())
        every { settingsStore.addGamesPromptDismissedUntil } returns flowOf(0L)
        every { repository.getEventsByType(any()) } returns flowOf(emptyList())
        every { repository.recentlyViewed() } returns flowOf(emptyList())
        coEvery { api.fetchUserInfo() } returns UserProfile(id = "me", name = "Me", email = "me@test.dev")
        coEvery { api.fetchUserProfile(any()) } returns UserProfileResponse(
            user = UserPublicProfile(id = "me", name = "Me"),
        )
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun viewModel() = GamesViewModel(repository, api, tokenStore, settingsStore)

    /** WhileSubscribed state flows only emit once collected. */
    private fun kotlinx.coroutines.CoroutineScope.subscribe(vm: GamesViewModel) {
        launch { vm.invitations.collect {} }
        launch { vm.rosterAdds.collect {} }
    }


    @Test
    fun `home invitations are exposed from the feed`() = runTest {
        coEvery { api.fetchHome() } returns HomeResponse(invitations = listOf(invitation))
        val vm = viewModel()
        backgroundScope.subscribe(vm)
        advanceUntilIdle()
        assertEquals(listOf("inv1"), vm.invitations.value.map { it.id })
    }

    @Test
    fun `roster adds already acknowledged are filtered out`() = runTest {
        every { settingsStore.rosterAddsAcked } returns flowOf(setOf("e2"))
        coEvery { api.fetchHome() } returns HomeResponse(rosterAdds = listOf(rosterAdd))
        val vm = viewModel()
        backgroundScope.subscribe(vm)
        advanceUntilIdle()
        assertEquals(emptyList<HomeRosterAdd>(), vm.rosterAdds.value)
    }

    @Test
    fun `responding to an invitation posts the action and refreshes the feed`() = runTest {
        coEvery { api.fetchHome() } returnsMany listOf(
            HomeResponse(invitations = listOf(invitation)),
            HomeResponse(invitations = emptyList()),
        )
        coEvery { api.respondToInvite("tok1", "accept") } returns InviteActionResponse(ok = true, action = "accepted")
        val vm = viewModel()
        backgroundScope.subscribe(vm)
        advanceUntilIdle()

        vm.respondToHomeInvitation("tok1", "accept")
        advanceUntilIdle()

        coVerify { api.respondToInvite("tok1", "accept") }
        assertEquals(emptyList<HomeInvitation>(), vm.invitations.value)
    }

    @Test
    fun `dismissing a roster add persists the acknowledgement`() = runTest {
        coEvery { api.fetchHome() } returns HomeResponse(rosterAdds = listOf(rosterAdd))
        val vm = viewModel()
        backgroundScope.subscribe(vm)
        advanceUntilIdle()

        vm.dismissRosterAdd("e2")
        advanceUntilIdle()

        coVerify { settingsStore.ackRosterAdd("e2") }
    }

    @Test
    fun `a failed response keeps the invitation`() = runTest {
        coEvery { api.fetchHome() } returns HomeResponse(invitations = listOf(invitation))
        coEvery { api.respondToInvite("tok1", "accept") } throws ApiException(500, "boom")
        val vm = viewModel()
        backgroundScope.subscribe(vm)
        advanceUntilIdle()

        vm.respondToHomeInvitation("tok1", "accept")
        advanceUntilIdle()

        assertEquals(listOf("inv1"), vm.invitations.value.map { it.id })
    }
}
