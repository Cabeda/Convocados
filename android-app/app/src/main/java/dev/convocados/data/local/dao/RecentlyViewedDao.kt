package dev.convocados.data.local.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import dev.convocados.data.local.entity.RecentlyViewedEventEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface RecentlyViewedDao {

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(event: RecentlyViewedEventEntity)

    /** Most recent first, capped — the UI shows a short list. */
    @Query("SELECT * FROM recently_viewed_events ORDER BY viewedAt DESC LIMIT :limit")
    fun recent(limit: Int = 10): Flow<List<RecentlyViewedEventEntity>>

    /** Prune beyond the cap so the table stays small. */
    @Query("DELETE FROM recently_viewed_events WHERE eventId NOT IN (SELECT eventId FROM recently_viewed_events ORDER BY viewedAt DESC LIMIT :keep)")
    suspend fun prune(keep: Int = 10)

    @Query("DELETE FROM recently_viewed_events")
    suspend fun clear()
}
