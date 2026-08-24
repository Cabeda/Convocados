package dev.convocados.ui.screen.invite

import dev.convocados.data.api.ApiException
import dev.convocados.data.api.ConvocadosApi
import dev.convocados.data.api.InviteGame
import dev.convocados.data.api.InviteLookupResponse
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
import org.junit.Assert.assertNotNull
import org.junit.Before
import org.junit.Test

/**
 * Regression tests: the invite screen deep link carries the token as a nav
 * argument. The ViewModel must fetch and respond with THAT token — previously
 * it read the token from its own (still null) state, called
 * GET /api/invite/<empty>, got an HTML fallback page back and rendered raw
 * markup on screen.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class InviteViewModelTest {

    private val api = mockk<ConvocadosApi>()
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
    fun load_fetches_with_the_token_from_the_deep_link() = runTest {
        coEvery { api.fetchInvite("tok-123") } returns InviteLookupResponse(
            valid = true,
            status = "pending",
            token = "tok-123",
            isInvitee = true,
            authenticated = true,
            invitedByName = "Cabeda",
            game = InviteGame(id = "g1", title = "Sweat Now", location = "Pitch", dateTime = "2026-08-25T10:00:00Z"),
        )
        val vm = InviteViewModel(api)
        vm.load("tok-123")
        advanceUntilIdle()

        coVerify(exactly = 1) { api.fetchInvite("tok-123") }
        assertEquals("tok-123", vm.state.value.data?.token)
        assertEquals(false, vm.state.value.loading)
    }

    @Test
    fun load_with_empty_token_does_not_hit_the_api() = runTest {
        val vm = InviteViewModel(api)
        vm.load("")
        advanceUntilIdle()

        coVerify(exactly = 0) { api.fetchInvite(any()) }
        assertNotNull(vm.state.value.error)
    }

    @Test
    fun respond_uses_the_loaded_token() = runTest {
        coEvery { api.fetchInvite("tok-abc") } returns InviteLookupResponse(
            valid = true, status = "pending", token = "tok-abc", isInvitee = true,
        )
        coEvery { api.respondToInvite("tok-abc", "accept") } returns mockk(relaxed = true)
        val vm = InviteViewModel(api)
        vm.load("tok-abc")
        advanceUntilIdle()

        vm.respond("accept")
        advanceUntilIdle()

        coVerify(exactly = 1) { api.respondToInvite("tok-abc", "accept") }
        assertEquals(true, vm.state.value.responded)
    }

    @Test
    fun error_from_api_surfaces_message_without_html() = runTest {
        coEvery { api.fetchInvite("tok-html") } throws ApiException(404, "<html>404 page</html>")
        val vm = InviteViewModel(api)
        vm.load("tok-html")
        advanceUntilIdle()

        // The ViewModel must not render server HTML — sanitize before display.
        org.junit.Assert.assertFalse(vm.state.value.error!!.contains("<"))
    }
}
