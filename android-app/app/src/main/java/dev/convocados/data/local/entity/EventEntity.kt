package dev.convocados.data.local.entity

import androidx.room.Entity
import androidx.room.PrimaryKey
import dev.convocados.data.api.EventSummary

@Entity(tableName = "events")
data class EventEntity(
    @PrimaryKey val id: String,
    val title: String,
    val location: String,
    val dateTime: String,
    val sport: String,
    val maxPlayers: Int,
    val playerCount: Int,
    val archivedAt: String?,
    val isRecurring: Boolean,
    val type: String // "owned", "joined", "archivedOwned", "archivedJoined"
)

fun EventEntity.toSummary() = EventSummary(
    id = id,
    title = title,
    location = location,
    dateTime = dateTime,
    sport = sport,
    maxPlayers = maxPlayers,
    playerCount = playerCount,
    archivedAt = archivedAt,
    isRecurring = isRecurring
)

fun EventSummary.toEntity(type: String) = EventEntity(
    id = id,
    title = title,
    location = location,
    dateTime = dateTime,
    sport = sport,
    maxPlayers = maxPlayers,
    playerCount = playerCount,
    archivedAt = archivedAt,
    isRecurring = isRecurring,
    type = type
)
