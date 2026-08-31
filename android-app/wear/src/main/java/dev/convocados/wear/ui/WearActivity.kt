package dev.convocados.wear.ui

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.lifecycleScope
import androidx.wear.ambient.AmbientLifecycleObserver
import dagger.hilt.android.AndroidEntryPoint
import dev.convocados.wear.data.auth.WearGoogleSignIn
import dev.convocados.wear.data.auth.WearRestoreCredentialCoordinator
import dev.convocados.wear.data.auth.WearTokenStore
import dev.convocados.wear.data.local.QuickGameStore
import dev.convocados.wear.ui.navigation.WearNavigation
import dev.convocados.wear.ui.theme.ConvocadosWearTheme
import kotlinx.coroutines.launch
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
    lateinit var restoreCredentialCoordinator: WearRestoreCredentialCoordinator

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

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        ambientObserver = AmbientLifecycleObserver(this, ambientCallback)
        lifecycle.addObserver(ambientObserver)
        lifecycleScope.launch {
            restoreCredentialCoordinator.restoreOrCreate(this@WearActivity)
        }

        setContent {
            ConvocadosWearTheme {
                CompositionLocalProvider(LocalAmbientMode provides isAmbient) {
                    WearNavigation(tokenStore, googleSignIn, restoreCredentialCoordinator, quickGameStore)
                }
            }
        }
    }
}
