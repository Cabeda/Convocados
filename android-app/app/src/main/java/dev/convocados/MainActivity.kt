package dev.convocados

import android.content.Intent
import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.lifecycle.lifecycleScope
import dagger.hilt.android.AndroidEntryPoint
import dev.convocados.data.auth.OAuthTokens
import dev.convocados.data.auth.RestoreCredentialCoordinator
import dev.convocados.data.auth.TokenStore
import dev.convocados.ui.ConvocadosRoot
import dev.convocados.ui.navigation.DeepLink
import kotlinx.coroutines.launch
import javax.inject.Inject

@AndroidEntryPoint
class MainActivity : AppCompatActivity() {

    @Inject lateinit var tokenStore: TokenStore
    @Inject lateinit var restoreCredentialCoordinator: RestoreCredentialCoordinator

    private var deepLink by mutableStateOf<String?>(null)
    private var intentVersion by mutableIntStateOf(0)

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)

        // Dev: inject token via ADB
        intent.getStringExtra("token")?.let { token ->
            tokenStore.setTokens(OAuthTokens(accessToken = token, refreshToken = "", expiresAt = System.currentTimeMillis() + 3600_000))
        }

        // A pending invite survives activity recreation (rotation) while the
        // user is signing in in another tab.
        deepLink = savedInstanceState?.getString(STATE_DEEP_LINK) ?: DeepLink.extract(intent)
        lifecycleScope.launch {
            restoreCredentialCoordinator.restoreOrCreate(this@MainActivity)
        }
        setContent { ConvocadosRoot(deepLink = deepLink, intentVersion = intentVersion) }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        // The OAuth callback arrives here after sign-in. Keep a pending invite
        // instead of overwriting it with convocados://auth?code=...
        deepLink = DeepLink.nextDeepLink(deepLink, DeepLink.extract(intent))
        // Increment version to trigger re-processing of the intent in ConvocadosRoot
        intentVersion++
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        outState.putString(STATE_DEEP_LINK, deepLink)
    }

    private companion object {
        const val STATE_DEEP_LINK = "pending_deep_link"
    }
}
