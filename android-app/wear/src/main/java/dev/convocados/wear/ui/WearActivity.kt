package dev.convocados.wear.ui

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.content.ContextCompat
import androidx.wear.ambient.AmbientLifecycleObserver
import dagger.hilt.android.AndroidEntryPoint
import dev.convocados.wear.data.auth.WearGoogleSignIn
import dev.convocados.wear.data.auth.WearTokenStore
import dev.convocados.wear.data.local.QuickGameStore
import dev.convocados.wear.ui.navigation.WearNavigation
import dev.convocados.wear.ui.theme.ConvocadosWearTheme
import javax.inject.Inject

/** Whether the display is in ambient (always-on) mode. */
val LocalAmbientMode = compositionLocalOf { false }

@AndroidEntryPoint
class WearActivity : ComponentActivity() {

    @Inject
    lateinit var tokenStore: WearTokenStore

    @Inject
    lateinit var googleSignIn: WearGoogleSignIn

    @Inject
    lateinit var quickGameStore: QuickGameStore

    private var isAmbient by mutableStateOf(false)

    private val ambientCallback = object : AmbientLifecycleObserver.AmbientLifecycleCallback {
        override fun onEnterAmbient(ambientDetails: AmbientLifecycleObserver.AmbientDetails) {
            isAmbient = true
        }
        override fun onExitAmbient() {
            isAmbient = false
        }
    }

    private lateinit var ambientObserver: AmbientLifecycleObserver

    private val notificationPermission = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { /* Ongoing Activity simply stays silent when denied */ }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        requestOngoingPermissionIfNeeded()

        ambientObserver = AmbientLifecycleObserver(this, ambientCallback)
        lifecycle.addObserver(ambientObserver)

        setContent {
            ConvocadosWearTheme {
                CompositionLocalProvider(LocalAmbientMode provides isAmbient) {
                    WearNavigation(tokenStore, googleSignIn, quickGameStore)
                }
            }
        }
    }

    /** POST_NOTIFICATIONS is required to post the live-score Ongoing Activity (API 33+). */
    private fun requestOngoingPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT < 33) return
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
        ) return
        notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
    }
}
