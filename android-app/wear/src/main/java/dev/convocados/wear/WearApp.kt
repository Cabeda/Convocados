package dev.convocados.wear

import android.app.Application
import android.os.Trace
import android.provider.Settings
import androidx.compose.runtime.Composer
import androidx.compose.runtime.CompositionTracer
import androidx.compose.runtime.InternalComposeTracingApi
import androidx.hilt.work.HiltWorkerFactory
import androidx.work.Configuration
import dagger.hilt.android.HiltAndroidApp
import dev.convocados.wear.util.composeTraceSectionName
import javax.inject.Inject

@HiltAndroidApp
class WearApp : Application(), Configuration.Provider {

    @Inject
    lateinit var workerFactory: HiltWorkerFactory

    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder()
            .setWorkerFactory(workerFactory)
            .build()

    override fun onCreate() {
        super.onCreate()
        if (BuildConfig.COMPOSE_TRACING && isComposeTracingEnabled()) installComposeTracer()
    }

    /**
     * The `-PcomposeTracing` build only guarantees the *markers* exist; the tracer
     * itself is a runtime switch so the same binary can produce both an unbiased
     * frame-timing baseline (off) and per-composable attribution (on) without a
     * reinstall. Toggle with:
     *   adb shell settings put global convocados_compose_tracing 1
     */
    private fun isComposeTracingEnabled(): Boolean = runCatching {
        Settings.Global.getInt(contentResolver, SETTING_NAME, 0) == 1
    }.getOrDefault(false)

    /**
     * Routes Compose's per-composable trace markers into atrace so Perfetto can
     * attribute `Recomposer:recompose` time to individual composables. Both halves
     * are required: the compiler must emit markers (`-PcomposeTracing` →
     * `includeTraceMarkers`) and a tracer must be installed here, otherwise the
     * runtime null-checks them away. Never on in release builds.
     */
    @OptIn(InternalComposeTracingApi::class)
    private fun installComposeTracer() {
        Composer.setTracer(object : CompositionTracer {
            override fun traceEventStart(key: Int, dirty1: Int, dirty2: Int, info: String) {
                // beginSection/endSection must stay paired, so never skip the begin.
                Trace.beginSection(composeTraceSectionName(info))
            }

            override fun traceEventEnd() {
                Trace.endSection()
            }

            override fun isTraceInProgress(): Boolean = true
        })
    }

    private companion object {
        const val SETTING_NAME = "convocados_compose_tracing"
    }
}
