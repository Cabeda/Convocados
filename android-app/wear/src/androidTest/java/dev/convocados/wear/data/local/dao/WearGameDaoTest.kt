package dev.convocados.wear.data.local.dao

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.cash.turbine.test
import dev.convocados.wear.data.local.WearDatabase
import dev.convocados.wear.data.local.entity.WearGameEntity
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class WearGameDaoTest {

    private lateinit var db: WearDatabase
    private lateinit var dao: WearGameDao

    @Before
    fun setup() {
        db = Room.inMemoryDatabaseBuilder(
            ApplicationProvider.getApplicationContext(),
            WearDatabase::class.java,
        ).allowMainThreadQueries().build()
        dao = db.gameDao()
    }

    @After
    fun tearDown() {
        db.close()
    }

    @Test
    fun insertAll_and_getAllGames_returns_sorted_by_dateTime() = runTest {
        val games = listOf(
            makeGame("2", "Game B", "2025-06-02T10:00:00Z", "owned"),
            makeGame("1", "Game A", "2025-06-01T10:00:00Z", "owned"),
        )
        dao.insertAll(games)

        dao.getAllGames().test {
            val result = awaitItem()
            assertEquals(2, result.size)
            assertEquals("1", result[0].id) // sorted by dateTime ASC
            assertEquals("2", result[1].id)
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun refreshGames_deletes_old_and_inserts_new_for_type() = runTest {
        // Insert initial owned games
        dao.insertAll(listOf(
            makeGame("1", "Old Game", "2025-01-01T10:00:00Z", "owned"),
        ))

        // Also insert a joined game that should NOT be deleted
        dao.insertAll(listOf(
            makeGame("j1", "Joined Game", "2025-01-01T10:00:00Z", "joined"),
        ))

        // Refresh owned games with new data
        val newOwned = listOf(
            makeGame("2", "New Game", "2025-02-01T10:00:00Z", "owned"),
        )
        dao.refreshGames("owned", newOwned)

        dao.getAllGames().test {
            val result = awaitItem()
            assertEquals(2, result.size) // 1 new owned + 1 joined
            val ids = result.map { it.id }.toSet()
            assertTrue("j1" in ids) // joined preserved
            assertTrue("2" in ids)  // new owned present
            assertFalse("1" in ids) // old owned deleted
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun refreshGames_is_atomic_type_only_deletes_matching_type() = runTest {
        dao.insertAll(listOf(
            makeGame("o1", "Owned 1", "2025-01-01T10:00:00Z", "owned"),
            makeGame("o2", "Owned 2", "2025-01-02T10:00:00Z", "owned"),
            makeGame("j1", "Joined 1", "2025-01-03T10:00:00Z", "joined"),
        ))

        // Refresh only "joined" type
        dao.refreshGames("joined", listOf(
            makeGame("j2", "Joined 2", "2025-01-04T10:00:00Z", "joined"),
        ))

        dao.getAllGames().test {
            val result = awaitItem()
            assertEquals(3, result.size) // 2 owned + 1 new joined
            val ids = result.map { it.id }.toSet()
            assertTrue("o1" in ids)
            assertTrue("o2" in ids)
            assertTrue("j2" in ids)
            assertFalse("j1" in ids) // old joined deleted
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun getGame_returns_game_by_id() = runTest {
        dao.insertAll(listOf(makeGame("abc", "My Game", "2025-01-01T10:00:00Z", "owned")))

        val game = dao.getGame("abc")
        assertNotNull(game)
        assertEquals("My Game", game!!.title)
    }

    @Test
    fun getGame_returns_null_for_missing_id() = runTest {
        assertNull(dao.getGame("nonexistent"))
    }

    @Test
    fun insertAll_with_replace_updates_existing() = runTest {
        dao.insertAll(listOf(makeGame("1", "Original", "2025-01-01T10:00:00Z", "owned")))
        dao.insertAll(listOf(makeGame("1", "Updated", "2025-01-01T10:00:00Z", "owned")))

        val game = dao.getGame("1")
        assertEquals("Updated", game!!.title)
    }

    private fun makeGame(id: String, title: String, dateTime: String, type: String) = WearGameEntity(
        id = id, title = title, location = "Field", dateTime = dateTime,
        sport = "Soccer", maxPlayers = 10, playerCount = 5,
        teamOneName = "Team 1", teamTwoName = "Team 2",
        isRecurring = false, type = type,
    )
}
