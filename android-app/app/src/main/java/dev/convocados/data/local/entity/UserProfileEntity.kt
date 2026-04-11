package dev.convocados.data.local.entity

import androidx.room.Entity
import androidx.room.PrimaryKey
import dev.convocados.data.api.UserProfile

@Entity(tableName = "user_profiles")
data class UserProfileEntity(
    @PrimaryKey val id: String,
    val name: String,
    val email: String,
    val image: String?
)

fun UserProfileEntity.toDomain() = UserProfile(
    id = id,
    name = name,
    email = email,
    image = image
)

fun UserProfile.toEntity() = UserProfileEntity(
    id = id,
    name = name,
    email = email,
    image = image
)
