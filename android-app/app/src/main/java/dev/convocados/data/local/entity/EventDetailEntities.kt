package dev.convocados.data.local.entity

import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey
import dev.convocados.data.api.EventDetail
import dev.convocados.data.api.GameHistory
import dev.convocados.data.api.Player
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

/** Shared Json for (de)serializing nested entity payloads like team results. */
internal val EntityJson = Json { ignoreUnknownKeys = true }

@Entity(tableName = "event_details")
data class EventDetailEntity(
    @PrimaryKey val id: String,
    val title: String,
    val location: String,
    val dateTime: String,
    val maxPlayers: Int,
    val sport: String,
    val ownerId: String?,
    val isAdmin: Boolean,
    val locked: Boolean,
    val teamOneName: String,
    val teamTwoName: String,
    /** JSON-encoded List<TeamResult> of the generated teams, or null if none. */
    val teamResultsJson: String? = null,
    /** JSON-encoded List<RosterPlayer> of pending invitees (ADR 0025), or null. */
    val invitedJson: String? = null,
    /** JSON-encoded List<RosterPlayer> of declined roster (ADR 0025), or null. */
    val declinedJson: String? = null,
)

@Entity(
    tableName = "players",
    foreignKeys = [
        ForeignKey(
            entity = EventDetailEntity::class,
            parentColumns = ["id"],
            childColumns = ["eventId"],
            onDelete = ForeignKey.CASCADE
        )
    ],
    indices = [Index("eventId")]
)
data class PlayerEntity(
    @PrimaryKey val id: String,
    val eventId: String,
    val name: String,
    val order: Int,
    val userId: String?,
    val image: String?,
)

@Entity(
    tableName = "game_history",
    foreignKeys = [
        ForeignKey(
            entity = EventDetailEntity::class,
            parentColumns = ["id"],
            childColumns = ["eventId"],
            onDelete = ForeignKey.CASCADE
        )
    ],
    indices = [Index("eventId")]
)
data class GameHistoryEntity(
    @PrimaryKey val id: String,
    val eventId: String,
    val dateTime: String,
    val scoreOne: Int?,
    val scoreTwo: Int?,
    val teamOneName: String,
    val teamTwoName: String,
)

fun EventDetail.toEntity() = EventDetailEntity(
    id = id,
    title = title,
    location = location,
    dateTime = dateTime,
    maxPlayers = maxPlayers,
    sport = sport,
    ownerId = ownerId,
    isAdmin = isAdmin,
    locked = locked,
    teamOneName = teamOneName,
    teamTwoName = teamTwoName,
    teamResultsJson = teamResults?.let { EntityJson.encodeToString(it) },
    // `invited`/`declined` are non-null lists — only takeIf can produce a null.
    invitedJson = invited.takeIf { it.isNotEmpty() }?.let { EntityJson.encodeToString(it) },
    declinedJson = declined.takeIf { it.isNotEmpty() }?.let { EntityJson.encodeToString(it) },
)

fun Player.toEntity(eventId: String) = PlayerEntity(
    id = id,
    eventId = eventId,
    name = name,
    order = order,
    userId = userId,
    image = image,
)

fun GameHistory.toEntity(eventId: String) = GameHistoryEntity(
    id = id,
    eventId = eventId,
    dateTime = dateTime,
    scoreOne = scoreOne,
    scoreTwo = scoreTwo,
    teamOneName = teamOneName,
    teamTwoName = teamTwoName
)
