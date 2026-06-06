package dev.convocados.data.auth

import android.content.Context

/**
 * Wear OS auth helper. On a real watch paired with a phone,
 * tokens are synced via WearAuthSync (Data Layer API).
 * For dev/emulator: use ADB token injection.
 */
class GoogleSignInHelper(private val context: Context) {
    fun isWearOs(): Boolean = context.packageManager.hasSystemFeature("android.hardware.type.watch")
}
