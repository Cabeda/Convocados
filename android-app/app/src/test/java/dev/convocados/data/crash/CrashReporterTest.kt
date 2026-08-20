package dev.convocados.data.crash

import com.google.firebase.crashlytics.FirebaseCrashlytics
import io.mockk.mockk
import io.mockk.verify
import org.junit.Test

class CrashReporterTest {

    private val crashlytics = mockk<FirebaseCrashlytics>(relaxed = true)
    private val reporter = CrashReporter(crashlytics)

    @Test
    fun `setUserId tags crash with internal id`() {
        reporter.setUserId("u_123")

        verify { crashlytics.setCustomKey("userId", "u_123") }
    }

    @Test
    fun `setUserId null clears the tag`() {
        reporter.setUserId(null)

        verify { crashlytics.setCustomKey("userId", "") }
    }

    @Test
    fun `record forwards the throwable`() {
        val throwable = RuntimeException("boom")

        reporter.record(throwable)

        verify { crashlytics.recordException(throwable) }
    }
}
