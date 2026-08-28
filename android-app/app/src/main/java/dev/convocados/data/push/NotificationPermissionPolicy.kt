package dev.convocados.data.push

/**
 * Keeps notification permission contextual instead of interrupting signed-out users.
 *
 * The platform dialog should only be shown after the app is ready, the user is
 * authenticated, and the user has explicitly asked to enable notifications.
 */
fun shouldRequestNotificationPermission(
    sdkInt: Int,
    isAuthenticated: Boolean,
    isReady: Boolean,
    isGranted: Boolean,
    userInitiated: Boolean,
): Boolean = sdkInt >= 33 &&
    isAuthenticated &&
    isReady &&
    !isGranted &&
    userInitiated
