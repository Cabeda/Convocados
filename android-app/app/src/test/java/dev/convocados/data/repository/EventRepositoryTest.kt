package dev.convocados.data.repository

import app.cash.turbine.test
import dev.convocados.data.api.ConvocadosApi
import dev.convocados.data.api.EventSummary
import dev.convocados.data.api.MyGamesResponse
import dev.convocados.data.local.dao.EventDao
import dev.convocados.data.local.dao.EventDetailDao
import dev.convocados.data.local.dao.RecentlyViewedDao
import dev.convocados.data.local.entity.EventEntity
import dev.convocados.ui.UiEventManager
import io.mockk.coEvery
import io.mockk.coJustRun
import io.mockk.coVerify
import io.mockk.mockk
import io.mockk.slot
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

class EventRepositoryTest {
    private val api = mockk<ConvocadosApi>()
    private val dao = mockk<EventDao>()
    private val detailDao = mockk<EventDetailDao>()
    private val recentlyViewedDao = mockk<RecentlyViewedDao>(relaxed = true)
    private val uiEventManager = mockk<UiEventManager>(relaxed = true)
    private val repository = EventRepository(api, dao, detailDao, recentlyViewedDao, uiEventManager)

    @Test
    fun `getEventsByType returns mapped summaries from dao`() = runTest {
        val entities = listOf(
            EventEntity("1", "Title", "Loc", "2024-01-01", "Soccer", 10, 5, null, false, null, null, "owned")
        )
        coEvery { dao.getEventsByType("owned") } returns flowOf(entities)

        repository.getEventsByType("owned").test {
            val item = awaitItem()
            assertEquals(1, item.size)
            assertEquals("1", item[0].id)
            assertEquals("Title", item[0].title)
            awaitComplete()
        }
    }

    @Test
    fun `refreshMyGames fetches from api and updates dao`() = runTest {
        val response = MyGamesResponse(
            owned = listOf(EventSummary("1", "T1", "L1", "D1", "S1", 10, 5, null, false)),
            admin = emptyList(),
            followed = emptyList(),
            archivedOwned = emptyList(),
        )
        coEvery { api.fetchMyGames() } returns response
        coEvery { dao.refreshEvents(any(), any()) } returns Unit

        repository.refreshMyGames()

        coVerify { api.fetchMyGames() }
        coVerify { dao.refreshEvents("owned", any()) }
        coVerify { dao.refreshEvents("admin", any()) }
        coVerify { dao.refreshEvents("followed", any()) }
    }

    @Test
    fun `refreshMyGames shows snackbar on failure`() = runTest {
        coEvery { api.fetchMyGames() } throws Exception("Network error")

        repository.refreshMyGames()

        coVerify { uiEventManager.showSnackbar("Failed to refresh games: Network error") }
    }

    @Test
    fun `recordEventView upserts and prunes`() = runTest {
        coJustRun { recentlyViewedDao.upsert(any()) }
        coJustRun { recentlyViewedDao.prune(any()) }
        val slot = slot<dev.convocados.data.local.entity.RecentlyViewedEventEntity>()

        repository.recordEventView("e1", "Game", "Pitch", "2026-08-25T19:00:00Z", "football")

        coVerify { recentlyViewedDao.upsert(capture(slot)) }
        assertEquals("e1", slot.captured.eventId)
        assertEquals("Game", slot.captured.title)
        assertEquals("Pitch", slot.captured.location)
        assertEquals("football", slot.captured.sport)
        coVerify { recentlyViewedDao.prune(10) }
    }

    @Test
    fun `recordEventView skips the demo placeholder`() = runTest {
        repository.recordEventView("demo", "Demo", "", "", "")

        coVerify(exactly = 0) { recentlyViewedDao.upsert(any()) }
        coVerify(exactly = 0) { recentlyViewedDao.prune(any()) }
    }
}
