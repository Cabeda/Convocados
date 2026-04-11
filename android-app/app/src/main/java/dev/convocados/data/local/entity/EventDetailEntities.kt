package dev.convocados.data.local.entity

import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey
import dev.convocados.data.api.EventDetail
import dev.convocados.data.api.GameHistory
import dev.convocados.data.api.Player

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
    val userId: String?
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
    teamTwoName = teamTwoName
)

fun Player.toEntity(eventId: String) = PlayerEntity(
    id = id,
    eventId = eventId,
    name = name,
    order = order,
    userId = userId
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
