package dev.convocados.data.push

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NotificationPermissionPolicyTest {

    @Test
    fun `does not request before Android 13`() {
        assertFalse(
            shouldRequestNotificationPermission(
                sdkInt = 32,
                isAuthenticated = true,
                isReady = true,
                isGranted = false,
                userInitiated = true,
            ),
        )
    }

    @Test
    fun `does not request while signed out or not ready`() {
        assertFalse(
            shouldRequestNotificationPermission(
                sdkInt = 35,
                isAuthenticated = false,
                isReady = true,
                isGranted = false,
                userInitiated = true,
            ),
        )
        assertFalse(
            shouldRequestNotificationPermission(
                sdkInt = 35,
                isAuthenticated = true,
                isReady = false,
                isGranted = false,
                userInitiated = true,
            ),
        )
    }

    @Test
    fun `does not request without explicit user intent`() {
        assertFalse(
            shouldRequestNotificationPermission(
                sdkInt = 35,
                isAuthenticated = true,
                isReady = true,
                isGranted = false,
                userInitiated = false,
            ),
        )
    }

    @Test
    fun `requests only for an authenticated ready user with denied permission`() {
        assertTrue(
            shouldRequestNotificationPermission(
                sdkInt = 35,
                isAuthenticated = true,
                isReady = true,
                isGranted = false,
                userInitiated = true,
            ),
        )
    }

    @Test
    fun `does not request when permission is already granted`() {
        assertFalse(
            shouldRequestNotificationPermission(
                sdkInt = 35,
                isAuthenticated = true,
                isReady = true,
                isGranted = true,
                userInitiated = true,
            ),
        )
    }
}
