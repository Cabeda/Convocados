package dev.convocados.data.push

import org.junit.Assert.assertEquals
import org.junit.Test

class DevicePushStateTest {

    @Test
    fun `enabled notifications are ON regardless of request history`() {
        assertEquals(
            DevicePushState.ON,
            classifyDevicePushState(
                notificationsEnabled = true,
                canRequestInApp = true,
                permissionGranted = true,
                shouldShowRationale = false,
                hasRequested = false,
            ),
        )
        assertEquals(
            DevicePushState.ON,
            classifyDevicePushState(
                notificationsEnabled = true,
                canRequestInApp = false,
                permissionGranted = false,
                shouldShowRationale = false,
                hasRequested = true,
            ),
        )
    }

    @Test
    fun `disabled and never requested is OFF (in-app request still possible)`() {
        assertEquals(
            DevicePushState.OFF,
            classifyDevicePushState(
                notificationsEnabled = false,
                canRequestInApp = true,
                permissionGranted = false,
                shouldShowRationale = false,
                hasRequested = false,
            ),
        )
    }

    @Test
    fun `disabled after request with rationale still showing is OFF`() {
        assertEquals(
            DevicePushState.OFF,
            classifyDevicePushState(
                notificationsEnabled = false,
                canRequestInApp = true,
                permissionGranted = false,
                shouldShowRationale = true,
                hasRequested = true,
            ),
        )
    }

    @Test
    fun `disabled after request without rationale is BLOCKED (permanently denied)`() {
        assertEquals(
            DevicePushState.BLOCKED,
            classifyDevicePushState(
                notificationsEnabled = false,
                canRequestInApp = true,
                permissionGranted = false,
                shouldShowRationale = false,
                hasRequested = true,
            ),
        )
    }

    @Test
    fun `permission granted but notifications toggled off in system settings is BLOCKED`() {
        assertEquals(
            DevicePushState.BLOCKED,
            classifyDevicePushState(
                notificationsEnabled = false,
                canRequestInApp = true,
                permissionGranted = true,
                shouldShowRationale = false,
                hasRequested = false,
            ),
        )
    }

    @Test
    fun `pre-33 devices have no in-app request path so disabled is BLOCKED`() {
        assertEquals(
            DevicePushState.BLOCKED,
            classifyDevicePushState(
                notificationsEnabled = false,
                canRequestInApp = false,
                permissionGranted = false,
                shouldShowRationale = false,
                hasRequested = false,
            ),
        )
    }
}
