package dev.convocados.wear.data.local.dao

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.cash.turbine.test
import dev.convocados.wear.data.local.WearDatabase
import dev.convocados.wear.data.local.entity.PendingScoreEntity
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class PendingScoreDaoTest {

    private lateinit var db: WearDatabase
    private lateinit var dao: PendingScoreDao

    @Before
    fun setup() {
        db = Room.inMemoryDatabaseBuilder(
            ApplicationProvider.getApplicationContext(),
            WearDatabase::class.java,
        ).allowMainThreadQueries().build()
        dao = db.pendingScoreDao()
    }

    @After
    fun tearDown() {
        db.close()
    }

    @Test
    fun insert_and_getAll_returns_ordered_by_createdAt() = runTest {
        dao.insert(makePending("e1", "h1", createdAt = 100))
        dao.insert(makePending("e2", "h2", createdAt = 200))

        val all = dao.getAll()
        assertEquals(2, all.size)
        assertEquals("e1", all[0].eventId) // createdAt ASC
        assertEquals("e2", all[1].eventId)
    }

    @Test
    fun delete_removes_specific_entry() = runTest {
        dao.insert(makePending("e1", "h1"))
        dao.insert(makePending("e2", "h2"))

        val all = dao.getAll()
        dao.delete(all[0])

        val remaining = dao.getAll()
        assertEquals(1, remaining.size)
        assertEquals("e2", remaining[0].eventId)
    }

    @Test
    fun observeCount_emits_current_count() = runTest {
        dao.observeCount().test {
            assertEquals(0, awaitItem())

            dao.insert(makePending("e1", "h1"))
            assertEquals(1, awaitItem())

            dao.insert(makePending("e2", "h2"))
            assertEquals(2, awaitItem())

            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun incrementRetry_increases_retryCount() = runTest {
        dao.insert(makePending("e1", "h1"))
        val inserted = dao.getAll().first()

        dao.incrementRetry(inserted.id)
        dao.incrementRetry(inserted.id)

        val updated = dao.getAll().first()
        assertEquals(2, updated.retryCount)
    }

    @Test
    fun observeStuckCount_counts_entries_at_or_above_the_cap() = runTest {
        dao.insert(makePending("e1", "h1"))
        val entry = dao.getAll().first()

        // Increment to the cap
        repeat(8) { dao.incrementRetry(entry.id) }

        dao.observeStuckCount(8).test {
            assertEquals(1, awaitItem())
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun deleteById_removes_a_specific_stuck_entry() = runTest {
        dao.insert(makePending("e1", "h1"))
        val entry = dao.getAll().first()

        repeat(8) { dao.incrementRetry(entry.id) }
        dao.deleteById(entry.id)

        val remaining = dao.getAll()
        assertEquals(0, remaining.size)
    }

    private fun makePending(
        eventId: String,
        historyId: String,
        createdAt: Long = System.currentTimeMillis(),
    ) = PendingScoreEntity(
        eventId = eventId, historyId = historyId,
        scoreOne = 1, scoreTwo = 0,
        teamOneName = "A", teamTwoName = "B",
        createdAt = createdAt,
    )
}
