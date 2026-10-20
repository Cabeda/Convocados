package dev.convocados.wear.data.local

import androidx.room.Room
import dev.convocados.wear.data.local.dao.WearPlayerDao
import dev.convocados.wear.data.local.entity.WearPlayerEntity
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/**
 * A roster refresh must keep the `local-player:` echo of an add that is still
 * queued (#1343). The old delete-everything refresh erased the player the
 * organizer had just added offline, on the very reconnect that should adopt it.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class WearPlayerDaoTest {

    private lateinit var db: WearDatabase
    private lateinit var dao: WearPlayerDao

    @Before
    fun setup() {
        db = Room.inMemoryDatabaseBuilder(RuntimeEnvironment.getApplication(), WearDatabase::class.java)
            .allowMainThreadQueries()
            .build()
        dao = db.playerDao()
    }

    @After
    fun teardown() {
        db.close()
    }

    @Test
    fun `refreshPlayers keeps a locally-added player that is still queued`() = runTest {
        dao.insertAll(
            listOf(
                player("local-player:1", "Alice", order = Int.MAX_VALUE),
                player("p1", "Bob", order = 0),
            ),
        )

        dao.refreshPlayers("e1", listOf(player("p1", "Bob", order = 0)))

        assertEquals(listOf("p1", "local-player:1"), dao.observePlayers("e1").first().map { it.id })
    }

    @Test
    fun `refreshPlayers replaces server players and drops the rest`() = runTest {
        dao.insertAll(listOf(player("p1", "Bob", order = 0), player("p2", "Gone", order = 1)))

        dao.refreshPlayers("e1", listOf(player("p3", "Cara", order = 0)))

        assertEquals(listOf("p3"), dao.observePlayers("e1").first().map { it.id })
    }

    private fun player(id: String, name: String, order: Int) = WearPlayerEntity(
        id = id,
        eventId = "e1",
        name = name,
        order = order,
        teamAssignment = "unassigned",
    )
}
