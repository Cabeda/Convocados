package dev.convocados.data.repository

import app.cash.turbine.test
import dev.convocados.data.api.ConvocadosApi
import dev.convocados.data.api.ProfilePhotoResponse
import dev.convocados.data.api.UserProfile
import dev.convocados.data.local.dao.UserDao
import dev.convocados.data.local.entity.UserProfileEntity
import dev.convocados.ui.UiEventManager
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test

class UserRepositoryTest {
    private val api = mockk<ConvocadosApi>()
    private val dao = mockk<UserDao>()
    private val uiEventManager = mockk<UiEventManager>(relaxed = true)
    private lateinit var repository: UserRepository

    @Before
    fun setup() {
        every { dao.getUserProfile() } returns flowOf(null)
        repository = UserRepository(api, dao, uiEventManager)
    }

    @Test
    fun `userProfile returns mapped domain from dao`() = runTest {
        val entity = UserProfileEntity("1", "User", "user@test.com", null)
        every { dao.getUserProfile() } returns flowOf(entity)
        val repository = UserRepository(api, dao, uiEventManager)

        repository.userProfile.test {
            val item = awaitItem()
            assertEquals("1", item?.id)
            assertEquals("User", item?.name)
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test
    fun `refreshUserProfile fetches from api and updates dao`() = runTest {
        val profile = UserProfile("1", "User", "user@test.com", null)
        coEvery { api.fetchUserInfo() } returns profile
        coEvery { dao.insert(any()) } returns Unit

        repository.refreshUserProfile()

        coVerify { api.fetchUserInfo() }
        coVerify { dao.insert(match { it.id == "1" && it.name == "User" }) }
    }

    @Test
    fun `refreshUserProfile shows snackbar on failure`() = runTest {
        coEvery { api.fetchUserInfo() } throws Exception("API error")

        repository.refreshUserProfile()

        coVerify { uiEventManager.showSnackbar("Failed to refresh profile: API error") }
    }

    @Test
    fun `clearUser calls dao clear`() = runTest {
        coEvery { dao.clear() } returns Unit

        repository.clearUser()

        coVerify { dao.clear() }
    }

    @Test
    fun `uploadProfilePhoto posts the data url and refreshes the profile`() = runTest {
        val dataUrl = "data:image/jpeg;base64,AAAA"
        coEvery { api.updateProfilePhoto(dataUrl) } returns ProfilePhotoResponse(ok = true, image = dataUrl)
        coEvery { api.fetchUserInfo() } returns UserProfile("1", "User", "user@test.com", dataUrl)
        coEvery { dao.insert(any()) } returns Unit

        repository.uploadProfilePhoto(dataUrl)

        coVerify { api.updateProfilePhoto(dataUrl) }
        coVerify { api.fetchUserInfo() }
    }

    @Test
    fun `uploadProfilePhoto shows a snackbar on failure`() = runTest {
        coEvery { api.updateProfilePhoto(any()) } throws Exception("API error")

        repository.uploadProfilePhoto("data:image/jpeg;base64,AAAA")

        coVerify { uiEventManager.showSnackbar("Failed to update photo: API error") }
    }

    @Test
    fun `removeProfilePhoto clears the photo and refreshes the profile`() = runTest {
        coEvery { api.removeProfilePhoto() } returns ProfilePhotoResponse(ok = true, image = null)
        coEvery { api.fetchUserInfo() } returns UserProfile("1", "User", "user@test.com", null)
        coEvery { dao.insert(any()) } returns Unit

        repository.removeProfilePhoto()

        coVerify { api.removeProfilePhoto() }
        coVerify { api.fetchUserInfo() }
    }

    @Test
    fun `removeProfilePhoto shows a snackbar on failure`() = runTest {
        coEvery { api.removeProfilePhoto() } throws Exception("API error")

        repository.removeProfilePhoto()

        coVerify { uiEventManager.showSnackbar("Failed to remove photo: API error") }
    }
}
