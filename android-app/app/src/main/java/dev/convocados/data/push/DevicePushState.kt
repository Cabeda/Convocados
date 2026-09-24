package dev.convocados.data.push

/**
 * Device-level notification state for the current install, mirroring the web
 * PWA's [DevicePushState](src/lib/devicePush.ts) vocabulary so both platforms
 * describe "this device" the same way. `needs-install` and `unsupported` are
 * web-only concepts and have no native equivalent.
 */
enum class DevicePushState { ON, OFF, BLOCKED }

/**
 * Maps Android notification facts to [DevicePushState].
 *
 * Web parity: `on` = notifications deliverable; `off` = not yet enabled but an
 * in-app permission request can still show the system dialog; `blocked` = the
 * system dialog will no longer appear (permanently denied, notifications
 * toggled off in settings, or pre-33 where no in-app request path exists).
 *
 * @param notificationsEnabled [androidx.core.app.NotificationManagerCompat.areNotificationsEnabled]
 * @param canRequestInApp true on API 33+ where POST_NOTIFICATIONS is a runtime permission
 * @param permissionGranted POST_NOTIFICATIONS granted (ignored when [canRequestInApp] is false)
 * @param shouldShowRationale true while the system would still show the rationale/dialog
 * @param hasRequested whether an in-app permission request was already attempted
 *   (distinguishes never-asked from permanently denied, since rationale is false for both)
 */
fun classifyDevicePushState(
    notificationsEnabled: Boolean,
    canRequestInApp: Boolean,
    permissionGranted: Boolean,
    shouldShowRationale: Boolean,
    hasRequested: Boolean,
): DevicePushState = when {
    notificationsEnabled -> DevicePushState.ON
    canRequestInApp && !permissionGranted && (!hasRequested || shouldShowRationale) -> DevicePushState.OFF
    else -> DevicePushState.BLOCKED
}
