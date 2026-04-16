package dev.convocados.wear.data.local.dao

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.cash.turbine.test
import dev.convocados.wear.data.local.WearDatabase
import dev.convocados.wear.data.local.entity.WearHistoryEntity
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class WearHistoryDaoTest {

    private lateinit var db: WearDatabase
    private lateinit var dao: WearHistoryDao

    @Before
    fun setup() {
        db = Room.inMemoryDatabaseBuilder(
            ApplicationProvider.getApplicationContext(),
            WearDatabase::class.java,
        ).allowMainThreadQueries().build()
        dao = db.historyDao()
    }

    @After
    fun tearDown() {
        db.close()
    }

    @Test
    fun getLatestHistory_returns_most_recent_by_dateTime() = runTest {
        dao.insertAll(listOf(
            makeHistory("h1", "e1", "2025-01-01T10:00:00Z", 1, 0),
            makeHistory("h2", "e1", "2025-01-02T10:00:00Z", 3, 2),
        ))

        val latest = dao.getLatestHistory("e1")
        assertNotNull(latest)
        assertEquals("h2", latest!!.id) // most recent by dateTime DESC
    }

    @Test
    fun getLatestHistory_returns_null_for_missing_event() = runTest {
        assertNull(dao.getLatestHistory("nonexistent"))
    }

    @Test
    fun observeLatestHistory_emits_updates() = runTest {
        dao.observeLatestHistory("e1").test {
            // Initially null
            assertNull(awaitItem())

            // Insert history
            dao.insertAll(listOf(makeHistory("h1", "e1", "2025-01-01T10:00:00Z", 1, 0)))
            val item = awaitItem()
            assertNotNull(item)
            assertEquals(1, item!!.scoreOne)

            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun refreshHistory_replaces_all_for_event() = runTest {
        dao.insertAll(listOf(
            makeHistory("h1", "e1", "2025-01-01T10:00:00Z", 1, 0),
            makeHistory("h2", "e2", "2025-01-01T10:00:00Z", 2, 2), // different event
        ))

        // Refresh only e1
        dao.refreshHistory("e1", listOf(
            makeHistory("h3", "e1", "2025-01-02T10:00:00Z", 5, 3),
        ))

        // e1 should have only h3
        val e1Latest = dao.getLatestHistory("e1")
        assertEquals("h3", e1Latest!!.id)
        assertEquals(5, e1Latest.scoreOne)

        // e2 should be untouched
        val e2Latest = dao.getLatestHistory("e2")
        assertEquals("h2", e2Latest!!.id)
    }

    @Test
    fun updateScore_modifies_existing_entry() = runTest {
        dao.insertAll(listOf(makeHistory("h1", "e1", "2025-01-01T10:00:00Z", 0, 0)))

        dao.updateScore("h1", 7, 4)

        val updated = dao.getLatestHistory("e1")
        assertEquals(7, updated!!.scoreOne)
        assertEquals(4, updated.scoreTwo)
    }

    @Test
    fun updateScore_does_nothing_for_missing_id() = runTest {
        dao.insertAll(listOf(makeHistory("h1", "e1", "2025-01-01T10:00:00Z", 1, 1)))

        dao.updateScore("nonexistent", 99, 99)

        // h1 unchanged
        val h1 = dao.getLatestHistory("e1")
        assertEquals(1, h1!!.scoreOne)
    }

    private fun makeHistory(id: String, eventId: String, dateTime: String, scoreOne: Int, scoreTwo: Int) =
        WearHistoryEntity(
            id = id, eventId = eventId, dateTime = dateTime,
            scoreOne = scoreOne, scoreTwo = scoreTwo,
            teamOneName = "Red", teamTwoName = "Blue", editable = true,
        )
}
