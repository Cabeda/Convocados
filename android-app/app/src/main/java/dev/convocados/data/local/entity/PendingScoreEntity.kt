package dev.convocados.data.local.entity

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "pending_scores")
data class PendingScoreEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val eventId: String,
    val historyId: String,
    val scoreOne: Int,
    val scoreTwo: Int,
    val createdAt: Long = System.currentTimeMillis(),
    val retryCount: Int = 0,
)
