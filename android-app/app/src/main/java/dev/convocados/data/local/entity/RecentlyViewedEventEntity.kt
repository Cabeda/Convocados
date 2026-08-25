package dev.convocados.data.local.entity

import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * Events the user opened recently — including invite/link visits for games
 * they never joined or followed. Powers the "Recently viewed" section on the
 * Games screen so a link-checked event is one tap away. Standalone (no FK):
 * link-visited events are not in the `events` cache table.
 */
@Entity(tableName = "recently_viewed_events")
data class RecentlyViewedEventEntity(
    @PrimaryKey val eventId: String,
    val title: String,
    val location: String,
    val dateTime: String,
    val sport: String,
    /** Epoch ms of the most recent view — ordering key. */
    val viewedAt: Long,
)
