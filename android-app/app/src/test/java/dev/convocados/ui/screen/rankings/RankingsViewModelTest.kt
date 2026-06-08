package dev.convocados.ui.screen.rankings

import app.cash.turbine.test
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
class RankingsViewModelTest {
    private val api = mockk<ConvocadosApi>()
    private val testDispatcher = StandardTestDispatcher()

    @Before
    fun setup() {
        Dispatchers.setMain(testDispatcher)
        coEvery { api.fetchUserInfo() } returns UserProfile("u1", "Test", "test@test.com")
    }

    @After
    fun tearDown() { Dispatchers.resetMain() }

    @Test
    fun `load fetches event and ratings`() = runTest {
        val event = EventDetail(id = "e1", title = "Game", dateTime = "2024-01-01T10:00:00Z", maxPlayers = 10)
        val ratings = listOf(PlayerRating("r1", "Player1", 1200, null, 5, 3, 1, 1))
        coEvery { api.fetchEvent("e1") } returns event
        coEvery { api.fetchRatings("e1", null) } returns PaginatedRatings(data = ratings)

        val vm = RankingsViewModel(api)
        advanceUntilIdle()

        vm.load("e1")
        advanceUntilIdle()

        assertEquals(ratings, vm.ratings.value)
        assertEquals(event, vm.event.value)
        assertEquals(false, vm.loading.value)
    }

    @Test
    fun `recalculate calls api and reloads`() = runTest {
        val event = EventDetail(id = "e1", title = "Game", dateTime = "2024-01-01T10:00:00Z", maxPlayers = 10)
        val ratings = listOf(PlayerRating("r1", "Player1", 1200, null, 5, 3, 1, 1))
        coEvery { api.fetchEvent("e1") } returns event
        coEvery { api.fetchRatings("e1", null) } returns PaginatedRatings(data = ratings)
        coEvery { api.recalculateRatings("e1") } returns OkResponse()

        val vm = RankingsViewModel(api)
        advanceUntilIdle()

        vm.load("e1")
        advanceUntilIdle()

        vm.recalculate("e1")
        advanceUntilIdle()

        coVerify { api.recalculateRatings("e1") }
        // load is called again after recalculate
        coVerify(atLeast = 2) { api.fetchRatings("e1", null) }
    }
}
