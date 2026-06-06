package dev.convocados.data.repository

import app.cash.turbine.test
import dev.convocados.data.api.ConvocadosApi
import dev.convocados.data.api.EventSummary
import dev.convocados.data.api.GameHistory
import dev.convocados.data.api.MyGamesResponse
import dev.convocados.data.local.dao.EventDao
import dev.convocados.data.local.dao.EventDetailDao
import dev.convocados.data.local.dao.PendingScoreDao
import dev.convocados.data.local.entity.EventEntity
import dev.convocados.data.local.entity.PendingScoreEntity
import dev.convocados.ui.UiEventManager
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import io.mockk.slot
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class EventRepositoryTest {
    private val api = mockk<ConvocadosApi>()
    private val dao = mockk<EventDao>()
    private val detailDao = mockk<EventDetailDao>(relaxUnitFun = true)
    private val pendingScoreDao = mockk<PendingScoreDao>(relaxUnitFun = true)
    private val uiEventManager = mockk<UiEventManager>(relaxed = true)
    private val repository = EventRepository(api, dao, detailDao, pendingScoreDao, uiEventManager)

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
    fun `saveScore updates local db and calls api when online`() = runTest {
        val history = GameHistory(id = "h1", dateTime = "2024-01-01")
        coEvery { api.updateScore("e1", "h1", 3, 2) } returns history

        val result = repository.saveScore("e1", "h1", 3, 2)

        assertTrue(result.isSuccess)
        coVerify { detailDao.updateHistoryScore("h1", 3, 2) }
        coVerify { api.updateScore("e1", "h1", 3, 2) }
        coVerify(exactly = 0) { pendingScoreDao.insert(any()) }
    }

    @Test
    fun `saveScore queues pending score when api fails (offline)`() = runTest {
        coEvery { api.updateScore("e1", "h1", 1, 0) } throws java.io.IOException("offline")
        val slot = slot<PendingScoreEntity>()
        coEvery { pendingScoreDao.insert(capture(slot)) } returns Unit

        val result = repository.saveScore("e1", "h1", 1, 0)

        assertTrue(result.isFailure)
        coVerify { detailDao.updateHistoryScore("h1", 1, 0) }
        coVerify { pendingScoreDao.insert(any()) }
        assertEquals("e1", slot.captured.eventId)
        assertEquals("h1", slot.captured.historyId)
        assertEquals(1, slot.captured.scoreOne)
        assertEquals(0, slot.captured.scoreTwo)
    }
}
