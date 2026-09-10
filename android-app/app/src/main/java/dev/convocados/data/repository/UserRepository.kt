package dev.convocados.data.repository

import dev.convocados.data.api.ConvocadosApi
import dev.convocados.data.api.UserProfile
import dev.convocados.data.local.dao.UserDao
import dev.convocados.data.local.entity.toDomain
import dev.convocados.data.local.entity.toEntity
import dev.convocados.ui.UiEventManager
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class UserRepository @Inject constructor(
    private val api: ConvocadosApi,
    private val userDao: UserDao,
    private val uiEventManager: UiEventManager
) {
    val userProfile: Flow<UserProfile?> = userDao.getUserProfile().map { it?.toDomain() }

    suspend fun refreshUserProfile() {
        try {
            val profile = api.fetchUserInfo()
            userDao.insert(profile.toEntity())
        } catch (e: Exception) {
            uiEventManager.showSnackbar("Failed to refresh profile: ${e.message}")
        }
    }

    /** Upload a cropped photo (JPEG data URL) and refresh the cached profile. */
    suspend fun uploadProfilePhoto(imageDataUrl: String) {
        try {
            api.updateProfilePhoto(imageDataUrl)
            refreshUserProfile()
        } catch (e: Exception) {
            uiEventManager.showSnackbar("Failed to update photo: ${e.message}")
        }
    }

    /** Clear the profile photo and refresh the cached profile. */
    suspend fun removeProfilePhoto() {
        try {
            api.removeProfilePhoto()
            refreshUserProfile()
        } catch (e: Exception) {
            uiEventManager.showSnackbar("Failed to remove photo: ${e.message}")
        }
    }

    suspend fun clearUser() {
        userDao.clear()
    }
}
