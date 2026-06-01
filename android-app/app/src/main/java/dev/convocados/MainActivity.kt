package dev.convocados

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import dagger.hilt.android.AndroidEntryPoint
import dev.convocados.data.auth.OAuthTokens
import dev.convocados.data.auth.TokenStore
import dev.convocados.ui.ConvocadosRoot
import javax.inject.Inject

@AndroidEntryPoint
class MainActivity : ComponentActivity() {

    @Inject lateinit var tokenStore: TokenStore

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

        deepLink = extractDeepLink(intent)
        setContent { ConvocadosRoot(deepLink = deepLink, intentVersion = intentVersion) }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        deepLink = extractDeepLink(intent)
        // Increment version to trigger re-processing of the intent in ConvocadosRoot
        intentVersion++
    }

    private fun extractDeepLink(intent: Intent): String? {
        intent.getStringExtra("deep_link")?.let { return it }
        intent.getStringExtra("navigate_to")?.let { return it }
        return null
    }
}
