package dev.convocados.ui.screen.games

import app.cash.turbine.test
import dev.convocados.data.api.ConvocadosApi
import dev.convocados.data.api.EventSummary
import dev.convocados.data.api.HomeAction
import dev.convocados.data.api.HomeResponse
import dev.convocados.data.api.ProfileEvent
import dev.convocados.data.api.UpNextGame
import dev.convocados.data.api.UserProfile
import dev.convocados.data.api.UserProfileResponse
import dev.convocados.data.api.UserPublicProfile
import dev.convocados.data.repository.EventRepository
import dev.convocados.data.repository.RecentlyViewedEvent
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.*
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class GamesViewModelTest {
    private val repository = mockk<EventRepository>(relaxed = true)
    private val api = mockk<ConvocadosApi>(relaxed = true)
    private val tokenStore = mockk<dev.convocados.data.auth.TokenStore>(relaxed = true)
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
    fun `viewModel observes repository flows`() = runTest {
        val owned = listOf(EventSummary("1", "T1", "L1", "D1", "S1", 10, 5, null, false))
        val followed = listOf(EventSummary("2", "T2", "L2", "D2", "S2", 12, 6, null, false))
        
        coEvery { repository.getEventsByType("owned") } returns flowOf(owned)
        coEvery { repository.getEventsByType("admin") } returns flowOf(emptyList())
        coEvery { repository.getEventsByType("followed") } returns flowOf(followed)
        coEvery { repository.getEventsByType("archivedOwned") } returns flowOf(emptyList())

        val viewModel = GamesViewModel(repository, api, tokenStore)

        viewModel.ownedGames.test {
            // stateIn starts with emptyList() initial value
            val item = awaitItem()
            if (item.isEmpty()) {
                assertEquals(owned, awaitItem())
            } else {
                assertEquals(owned, item)
            }
        }
    }

    @Test
    fun `refresh calls repository refresh`() = runTest {
        coEvery { repository.getEventsByType(any()) } returns flowOf(emptyList())
        val viewModel = GamesViewModel(repository, api, tokenStore)

        // Let init { refresh() } complete
        advanceUntilIdle()

        viewModel.refreshing.test {
            assertEquals(false, awaitItem())
            viewModel.refresh()
            assertEquals(true, awaitItem())
            assertEquals(false, awaitItem())
        }

        coVerify(atLeast = 2) { repository.refreshMyGames() }
    }

    @Test
    fun `refresh loads home feed from api`() = runTest {
        coEvery { repository.getEventsByType(any()) } returns flowOf(emptyList())
        coEvery { api.fetchHome() } returns HomeResponse(
            upNext = listOf(
                UpNextGame(
                    id = "ev-1",
                    title = "Sunday Football",
                    dateTime = "2026-08-01T19:00:00Z",
                    maxPlayers = 10,
                    playerCount = 6,
                ),
            ),
            discover = emptyList(),
        )

        val viewModel = GamesViewModel(repository, api, tokenStore)
        advanceUntilIdle()

        viewModel.home.test {
            val item = awaitItem()
            val feed = if (item == null) awaitItem() else item
            assertEquals("ev-1", feed?.upNext?.first()?.id)
        }
    }

    @Test
    fun `home exposes the add-games growth prompt flag`() = runTest {
        coEvery { repository.getEventsByType(any()) } returns flowOf(emptyList())
        coEvery { api.fetchHome() } returns HomeResponse(suggestAddGames = true)

        val viewModel = GamesViewModel(repository, api, tokenStore)
        advanceUntilIdle()

        assertEquals(true, viewModel.home.value?.suggestAddGames)
    }

    @Test
    fun `refresh exposes home actions from the feed`() = runTest {
        coEvery { repository.getEventsByType(any()) } returns flowOf(emptyList())
        coEvery { api.fetchHome() } returns HomeResponse(
            actions = listOf(
                HomeAction(
                    type = "pay_share",
                    eventId = "ev-1",
                    eventTitle = "Sunday Football",
                    dateTime = "2026-08-01T19:00:00Z",
                    amount = 12.5,
                    currency = "EUR",
                ),
            ),
        )

        val viewModel = GamesViewModel(repository, api, tokenStore)
        advanceUntilIdle()

        assertEquals("pay_share", viewModel.home.value?.actions?.first()?.type)
    }

    @Test
    fun `home keeps previous value when the api fails (offline degrade)`() = runTest {        coEvery { repository.getEventsByType(any()) } returns flowOf(emptyList())
        coEvery { api.fetchHome() } returns HomeResponse(
            upNext = listOf(
                UpNextGame(
                    id = "ev-keep",
                    title = "Kept Game",
                    dateTime = "2026-08-01T19:00:00Z",
                    maxPlayers = 10,
                    playerCount = 6,
                ),
            ),
        )

        val viewModel = GamesViewModel(repository, api, tokenStore)
        advanceUntilIdle()
        assertEquals("ev-keep", viewModel.home.value?.upNext?.first()?.id)

        coEvery { api.fetchHome() } throws RuntimeException("offline")
        viewModel.refresh()
        advanceUntilIdle()

        assertEquals("ev-keep", viewModel.home.value?.upNext?.first()?.id)
    }

    @Test
    fun `recentlyViewed exposes repository flow`() = runTest {        coEvery { repository.getEventsByType(any()) } returns flowOf(emptyList())
        val viewed = listOf(
            RecentlyViewedEvent("ev-1", "Thursday 5-a-side", "Pitch 2", "2026-08-20T19:00:00Z", "football", 1000L),
            RecentlyViewedEvent("ev-2", "Volleyball night", "Gym", "2026-08-22T20:00:00Z", "volleyball", 2000L),
        )
        coEvery { repository.recentlyViewed() } returns flowOf(viewed)

        val viewModel = GamesViewModel(repository, api, tokenStore)
        advanceUntilIdle()

        viewModel.recentlyViewed.test {
            val item = awaitItem()
            if (item.isEmpty()) assertEquals(viewed, awaitItem()) else assertEquals(viewed, item)
        }
    }

    @Test
    fun `participatedEvents maps own profile joined games`() = runTest {
        coEvery { repository.getEventsByType(any()) } returns flowOf(emptyList())
        coEvery { api.fetchUserInfo() } returns UserProfile(id = "me", name = "Me", email = "me@test.com")
        coEvery { api.fetchUserProfile("me") } returns UserProfileResponse(
            user = UserPublicProfile(id = "me", name = "Me"),
            joined = listOf(
                ProfileEvent(id = "ev-9", title = "Monday Futsal", sport = "futsal", dateTime = "2026-08-01T19:00:00Z", playerCount = 8, maxPlayers = 10),
            ),
        )

        val viewModel = GamesViewModel(repository, api, tokenStore)
        advanceUntilIdle()

        viewModel.participatedEvents.test {
            val item = awaitItem()
            val events = if (item.isEmpty()) awaitItem() else item
            assertEquals(1, events.size)
            assertEquals("ev-9", events[0].id)
            assertEquals("Monday Futsal", events[0].title)
        }
    }
}
