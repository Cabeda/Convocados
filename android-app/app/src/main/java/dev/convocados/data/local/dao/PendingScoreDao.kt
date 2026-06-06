package dev.convocados.data.local.dao

import androidx.room.*
import dev.convocados.data.local.entity.PendingScoreEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface PendingScoreDao {
    @Query("SELECT * FROM pending_scores ORDER BY createdAt ASC")
    suspend fun getAll(): List<PendingScoreEntity>

    @Query("SELECT COUNT(*) FROM pending_scores")
    fun observeCount(): Flow<Int>

    @Insert
    suspend fun insert(score: PendingScoreEntity)

    @Delete
    suspend fun delete(score: PendingScoreEntity)

    @Query("UPDATE pending_scores SET retryCount = retryCount + 1 WHERE id = :id")
    suspend fun incrementRetry(id: Long)

    @Query("DELETE FROM pending_scores WHERE retryCount >= 5")
    suspend fun deleteStale()
}
