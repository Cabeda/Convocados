package dev.convocados.wear.data.local.entity

import androidx.room.Entity
import androidx.room.PrimaryKey

/** Cached game (event) for the game list screen. */
@Entity(tableName = "wear_games")
data class WearGameEntity(
    @PrimaryKey val id: String,
    val title: String,
    val location: String,
    val dateTime: String,
    val sport: String,
    val maxPlayers: Int,
    val playerCount: Int,
    val teamOneName: String,
    val teamTwoName: String,
    val isRecurring: Boolean,
    val archivedAt: String? = null,
    val type: String, // "owned" | "joined" | "archived_owned" | "archived_joined"
    val cachedAt: Long = System.currentTimeMillis(),
)

/** Pending score update queued for sync when online. */
@Entity(tableName = "pending_scores")
data class PendingScoreEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val eventId: String,
    val historyId: String,
    val scoreOne: Int,
    val scoreTwo: Int,
    val teamOneName: String,
    val teamTwoName: String,
    val createdAt: Long = System.currentTimeMillis(),
    val retryCount: Int = 0,
)

/** Cached latest game history entry per event (for knowing the historyId). */
@Entity(tableName = "wear_history")
data class WearHistoryEntity(
    @PrimaryKey val id: String,
    val eventId: String,
    val dateTime: String,
    val scoreOne: Int?,
    val scoreTwo: Int?,
    val teamOneName: String,
    val teamTwoName: String,
    val editable: Boolean,
)

/** Cached team player for a specific event. */
@Entity(tableName = "wear_players", foreignKeys = [])
data class WearPlayerEntity(
    @PrimaryKey val id: String,
    val eventId: String,
    val name: String,
    val order: Int,
    val teamAssignment: String, // "teamOne" | "teamTwo" | "unassigned" | "bench"
)

/** Pending roster change queued for sync when online. */
@Entity(tableName = "pending_roster_changes")
data class PendingRosterChangeEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val eventId: String,
    val teamOnePlayerIds: String, // JSON array serialized as string
    val teamTwoPlayerIds: String, // JSON array serialized as string
    val createdAt: Long = System.currentTimeMillis(),
    val retryCount: Int = 0,
)
