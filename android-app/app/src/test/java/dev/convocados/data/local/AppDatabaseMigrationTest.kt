package dev.convocados.data.local

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import androidx.room.Room
import androidx.sqlite.db.SupportSQLiteDatabase
import androidx.test.core.app.ApplicationProvider
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Regression tests for the "app crashes after update" Room schema bug.
 *
 * `0fe526e6` (feat: show profile avatars) added the nullable `players.image` column to the
 * Room schema but did not bump the [AppDatabase] version. Two distinct v4 schemas shipped
 * (pre/post Aug 2026). Any device whose `convocados.db` was created by the pre-August build
 * crashes on open with:
 *
 *   "Room cannot verify the data integrity ... Expected identity hash: 59f18b…, found: 4f8f6c…"
 *
 * `fallbackToDestructiveMigration()` does not rescue this case because the stored and current
 * version numbers are both 4 — Room only falls back when versions differ.
 *
 * The fix bumps the schema to v5 and ships [AppDatabase.MIGRATION_4_5], which must tolerate
 * BOTH v4 schemas (with and without `players.image`).
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class AppDatabaseMigrationTest {

    private val context: Context = ApplicationProvider.getApplicationContext()
    private val dbName = "convocados-migration-test.db"

    /** Identity hash of the v4 schema WITHOUT `players.image` — captured from a real device crash. */
    private val legacyV4IdentityHash = "4f8f6c3746b8ba37267d2c272c2d2b05"

    /** Identity hash of the v4 schema WITH `players.image` (current generated impl). */
    private val newV4IdentityHash = "59f18b31832269d677e17b190326d0a4"

    @After
    fun tearDown() {
        context.deleteDatabase(dbName)
    }

    @Test
    fun `legacy v4 database without players image migrates and keeps data`() {
        createV4Database(playersImage = false, identityHash = legacyV4IdentityHash)

        val db = openWithMigration()
        try {
            val conn = db.openHelper.writableDatabase
            assertEquals("6", queryScalar(conn, "PRAGMA user_version"))
            assertTrue("players.image column should exist after migration", hasColumn(conn, "players", "image"))
            assertEquals("Ana", queryScalar(conn, "SELECT name FROM players WHERE id = 'p1'"))
            assertNull(queryScalar(conn, "SELECT image FROM players WHERE id = 'p1'"))
            assertTrue("recently_viewed_events table should exist after migration", tableExists(conn, "recently_viewed_events"))
        } finally {
            db.close()
        }
    }

    @Test
    fun `v4 database that already has players image migrates without duplicating the column`() {
        createV4Database(playersImage = true, identityHash = newV4IdentityHash)

        val db = openWithMigration()
        try {
            val conn = db.openHelper.writableDatabase
            assertEquals("6", queryScalar(conn, "PRAGMA user_version"))
            assertTrue("players.image column should survive migration", hasColumn(conn, "players", "image"))
            assertEquals("avatar.png", queryScalar(conn, "SELECT image FROM players WHERE id = 'p1'"))
            assertTrue("recently_viewed_events table should exist after migration", tableExists(conn, "recently_viewed_events"))
        } finally {
            db.close()
        }
    }

    private fun openWithMigration(): AppDatabase = Room.databaseBuilder(
        context,
        AppDatabase::class.java,
        dbName,
    ).addMigrations(AppDatabase.MIGRATION_4_5, AppDatabase.MIGRATION_5_6).build()

    /** Creates the `convocados.db` schema exactly as Room v4 generated it, at version 4. */
    private fun createV4Database(playersImage: Boolean, identityHash: String) {
        context.deleteDatabase(dbName)
        val db = context.openOrCreateDatabase(dbName, Context.MODE_PRIVATE, null)
        val playersImageSql = if (playersImage) ", `image` TEXT" else ""

        db.execSQL(
            "CREATE TABLE IF NOT EXISTS `events` (" +
                "`id` TEXT NOT NULL, `title` TEXT NOT NULL, `location` TEXT NOT NULL, " +
                "`dateTime` TEXT NOT NULL, `sport` TEXT NOT NULL, `maxPlayers` INTEGER NOT NULL, " +
                "`playerCount` INTEGER NOT NULL, `archivedAt` TEXT, `isRecurring` INTEGER NOT NULL, " +
                "`lastScoreOne` INTEGER, `lastScoreTwo` INTEGER, `type` TEXT NOT NULL, " +
                "PRIMARY KEY(`id`))"
        )
        db.execSQL(
            "CREATE TABLE IF NOT EXISTS `user_profiles` (" +
                "`id` TEXT NOT NULL, `name` TEXT NOT NULL, `email` TEXT NOT NULL, `image` TEXT, " +
                "PRIMARY KEY(`id`))"
        )
        db.execSQL(
            "CREATE TABLE IF NOT EXISTS `event_details` (" +
                "`id` TEXT NOT NULL, `title` TEXT NOT NULL, `location` TEXT NOT NULL, " +
                "`dateTime` TEXT NOT NULL, `maxPlayers` INTEGER NOT NULL, `sport` TEXT NOT NULL, " +
                "`ownerId` TEXT, `isAdmin` INTEGER NOT NULL, `locked` INTEGER NOT NULL, " +
                "`teamOneName` TEXT NOT NULL, `teamTwoName` TEXT NOT NULL, `teamResultsJson` TEXT, " +
                "PRIMARY KEY(`id`))"
        )
        db.execSQL(
            "CREATE TABLE IF NOT EXISTS `players` (" +
                "`id` TEXT NOT NULL, `eventId` TEXT NOT NULL, `name` TEXT NOT NULL, " +
                "`order` INTEGER NOT NULL, `userId` TEXT$playersImageSql, " +
                "PRIMARY KEY(`id`), " +
                "FOREIGN KEY(`eventId`) REFERENCES `event_details`(`id`) " +
                "ON UPDATE NO ACTION ON DELETE CASCADE )"
        )
        db.execSQL("CREATE INDEX IF NOT EXISTS `index_players_eventId` ON `players` (`eventId`)")
        db.execSQL(
            "CREATE TABLE IF NOT EXISTS `game_history` (" +
                "`id` TEXT NOT NULL, `eventId` TEXT NOT NULL, `dateTime` TEXT NOT NULL, " +
                "`scoreOne` INTEGER, `scoreTwo` INTEGER, `teamOneName` TEXT NOT NULL, " +
                "`teamTwoName` TEXT NOT NULL, PRIMARY KEY(`id`), " +
                "FOREIGN KEY(`eventId`) REFERENCES `event_details`(`id`) " +
                "ON UPDATE NO ACTION ON DELETE CASCADE )"
        )
        db.execSQL("CREATE INDEX IF NOT EXISTS `index_game_history_eventId` ON `game_history` (`eventId`)")
        db.execSQL("CREATE TABLE IF NOT EXISTS room_master_table (id INTEGER PRIMARY KEY,identity_hash TEXT)")
        db.execSQL("INSERT OR REPLACE INTO room_master_table (id,identity_hash) VALUES(42, '$identityHash')")

        db.execSQL(
            "INSERT INTO `event_details` (id, title, location, dateTime, maxPlayers, sport, isAdmin, locked, teamOneName, teamTwoName) " +
                "VALUES ('e1', 'Match', 'Pitch', '2026-08-18T19:00:00Z', 10, 'football', 0, 0, 'A', 'B')"
        )
        db.execSQL(
            "INSERT INTO `players` (id, eventId, name, `order`, userId) " +
                "VALUES ('p1', 'e1', 'Ana', 0, 'u1'), ('p2', 'e1', 'Beto', 1, 'u2')"
        )
        if (playersImage) {
            db.execSQL("UPDATE `players` SET image = 'avatar.png' WHERE id = 'p1'")
        }

        db.execSQL("PRAGMA user_version = 4")
        db.close()
    }

    private fun queryScalar(db: SupportSQLiteDatabase, sql: String): String? =
        db.query(sql).use { cursor ->
            cursor.moveToFirst()
            cursor.columnCount.takeIf { it > 0 }?.let { cursor.getString(0) }
        }

    private fun hasColumn(db: SupportSQLiteDatabase, table: String, column: String): Boolean =
        db.query("PRAGMA table_info(`$table`)").use { cursor ->
            while (cursor.moveToNext()) {
                if (cursor.getString(1) == column) return true
            }
            false
        }

    private fun tableExists(db: SupportSQLiteDatabase, table: String): Boolean =
        db.query("SELECT name FROM sqlite_master WHERE type='table' AND name=?", arrayOf(table))
            .use { cursor -> cursor.moveToFirst() }
}
