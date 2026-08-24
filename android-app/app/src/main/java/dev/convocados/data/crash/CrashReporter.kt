package dev.convocados.data.crash

import com.google.firebase.crashlytics.FirebaseCrashlytics

/**
 * Thin wrapper around Firebase Crashlytics.
 *
 * Crash collection is anonymous by default. We only tag the user's internal id
 * (not any PII like email/name) as a custom key so a crash can be correlated to
 * an account in the dashboard without collecting personal data.
 */
class CrashReporter(private val crashlytics: FirebaseCrashlytics?) {

    /** Tag subsequent crash reports with the user's internal id. Blank/null clears it. */
    fun setUserId(userId: String?) {
        crashlytics?.setCustomKey(KEY_USER_ID, userId ?: "")
    }

    /** Record a non-fatal exception so it shows up in the dashboard. */
    fun record(throwable: Throwable) {
        crashlytics?.recordException(throwable)
    }

    companion object {
        const val KEY_USER_ID = "userId"
    }
}
